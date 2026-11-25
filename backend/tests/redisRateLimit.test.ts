import { vi, describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../lib/redis.js';
import { RedisRateLimitStore } from '../lib/redisRateLimitStore.js';
import { createLoginRateLimit } from '../middleware/loginRateLimit.js';

// The shared setup replaces the limiter with a pass-through; this file tests
// the real one.
vi.unmock('../middleware/loginRateLimit.js');

// CONCEPT: redis-rate-limiting. These tests need a REAL Redis, so they are
// skipped unless TEST_REDIS_URL is set (for example redis://127.0.0.1:6379
// with the Docker container from the setup notes). They never run in CI.
const testRedisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = testRedisUrl ? describe : describe.skip;

const RIGHT_PASSWORD = 'right-password';

// The client does not queue commands (fail fast), so a command sent before
// the connection is ready is rejected. Tests therefore wait for "ready".
async function waitUntilReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return;
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));
}

// A tiny app that stands in for the login route: the limiter in front, and a
// handler that answers 200 for the right password and 401 otherwise. The
// real limiter is under test; the database is not needed.
function buildLoginApp(redisClient: Redis | null) {
  const app = express();
  app.use(express.json());
  app.post('/login', ...createLoginRateLimit(redisClient), (req: Request, res: Response) => {
    const passwordIsRight = (req.body as { password?: string }).password === RIGHT_PASSWORD;
    res.status(passwordIsRight ? 200 : 401).json({ ok: passwordIsRight });
  });
  return app;
}

describeWithRedis('login limiter with Redis counters', () => {
  let redisClient: Redis;

  beforeAll(async () => {
    redisClient = createRedisClient(testRedisUrl as string);
    await waitUntilReady(redisClient);
  });

  beforeEach(async () => {
    await redisClient.flushdb();
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  describe('RedisRateLimitStore', () => {
    function makeStore(prefix: string, windowMs = 60_000) {
      const store = new RedisRateLimitStore(redisClient, prefix);
      store.init({ windowMs } as never);
      return store;
    }

    it('counts hits per key and reports when the window ends', async () => {
      const store = makeStore('rl:test:');
      const first = await store.increment('a');
      const second = await store.increment('a');
      const other = await store.increment('b');
      expect([first.totalHits, second.totalHits, other.totalHits]).toEqual([1, 2, 1]);
      const msUntilReset = (second.resetTime as Date).getTime() - Date.now();
      expect(msUntilReset).toBeGreaterThan(50_000);
      expect(msUntilReset).toBeLessThanOrEqual(60_000);
    });

    it('gives every counter an expiry, so Redis cleans up by itself', async () => {
      const store = makeStore('rl:test:', 60_000);
      await store.increment('a');
      const millisecondsLeft = await redisClient.pttl('rl:test:a');
      expect(millisecondsLeft).toBeGreaterThan(0);
      expect(millisecondsLeft).toBeLessThanOrEqual(60_000);
    });

    it('starts a fresh count after the window has passed', async () => {
      const store = makeStore('rl:test:', 300);
      await store.increment('a');
      await store.increment('a');
      await new Promise((resolve) => setTimeout(resolve, 450));
      const afterWindow = await store.increment('a');
      expect(afterWindow.totalHits).toBe(1);
    });

    it('does not reset the expiry on later hits', async () => {
      const store = makeStore('rl:test:', 1000);
      await store.increment('a');
      await new Promise((resolve) => setTimeout(resolve, 400));
      await store.increment('a');
      const millisecondsLeft = await redisClient.pttl('rl:test:a');
      expect(millisecondsLeft).toBeLessThan(750);
    });

    it('decrement lowers the count, and does nothing to a counter that is gone', async () => {
      const store = makeStore('rl:test:');
      await store.increment('a');
      await store.increment('a');
      await store.decrement('a');
      expect((await store.increment('a')).totalHits).toBe(2);

      await store.decrement('never-used');
      expect(await redisClient.exists('rl:test:never-used')).toBe(0);
    });

    it('resetKey removes the counter', async () => {
      const store = makeStore('rl:test:');
      await store.increment('a');
      await store.resetKey('a');
      expect((await store.increment('a')).totalHits).toBe(1);
    });

    it('different prefixes do not share counters', async () => {
      const ipStore = makeStore('rl:one:');
      const emailStore = makeStore('rl:two:');
      await ipStore.increment('same');
      await ipStore.increment('same');
      expect((await emailStore.increment('same')).totalHits).toBe(1);
    });

    it('two store instances (two servers) count together', async () => {
      const serverA = makeStore('rl:test:');
      const serverB = makeStore('rl:test:');
      await serverA.increment('a');
      await serverB.increment('a');
      expect((await serverA.increment('a')).totalHits).toBe(3);
    });
  });

  describe('through the login route', () => {
    it('blocks the 6th failed login for one email and keeps another email unaffected', async () => {
      const app = buildLoginApp(redisClient);
      for (let attempt = 1; attempt <= 5; attempt++) {
        const res = await request(app).post('/login').send({ email: 'victim@example.com', password: 'wrong' });
        expect(res.status).toBe(401);
      }
      const blocked = await request(app).post('/login').send({ email: 'victim@example.com', password: 'wrong' });
      expect(blocked.status).toBe(429);

      const other = await request(app).post('/login').send({ email: 'other@example.com', password: RIGHT_PASSWORD });
      expect(other.status).toBe(200);
    });

    it('counts failed logins across two servers sharing one Redis', async () => {
      const serverA = buildLoginApp(redisClient);
      const serverB = buildLoginApp(redisClient);
      for (let attempt = 1; attempt <= 3; attempt++) {
        expect((await request(serverA).post('/login').send({ email: 'x@example.com', password: 'wrong' })).status).toBe(401);
      }
      for (let attempt = 1; attempt <= 2; attempt++) {
        expect((await request(serverB).post('/login').send({ email: 'x@example.com', password: 'wrong' })).status).toBe(401);
      }
      // 3 failures on A plus 2 on B: the 6th attempt is refused on EITHER server
      expect((await request(serverA).post('/login').send({ email: 'x@example.com', password: 'wrong' })).status).toBe(429);
      expect((await request(serverB).post('/login').send({ email: 'x@example.com', password: 'wrong' })).status).toBe(429);
    });

    it('without Redis, two servers each keep their own count (the problem Redis solves)', async () => {
      const serverA = buildLoginApp(null);
      const serverB = buildLoginApp(null);
      for (let attempt = 1; attempt <= 3; attempt++) {
        await request(serverA).post('/login').send({ email: 'y@example.com', password: 'wrong' });
      }
      for (let attempt = 1; attempt <= 2; attempt++) {
        await request(serverB).post('/login').send({ email: 'y@example.com', password: 'wrong' });
      }
      expect((await request(serverA).post('/login').send({ email: 'y@example.com', password: 'wrong' })).status).toBe(401);
    });

    it('successful logins do not use up the per-email allowance', async () => {
      const app = buildLoginApp(redisClient);
      for (let attempt = 1; attempt <= 8; attempt++) {
        const res = await request(app).post('/login').send({ email: 'ok@example.com', password: RIGHT_PASSWORD });
        expect(res.status).toBe(200);
      }
      const wrong = await request(app).post('/login').send({ email: 'ok@example.com', password: 'wrong' });
      expect(wrong.status).toBe(401);
    });

    it('limits per IP: the 21st request from one address is refused whatever the email', async () => {
      const app = buildLoginApp(redisClient);
      for (let attempt = 1; attempt <= 20; attempt++) {
        const res = await request(app).post('/login').send({ email: `user${attempt}@example.com`, password: RIGHT_PASSWORD });
        expect(res.status).toBe(200);
      }
      const refused = await request(app).post('/login').send({ email: 'user21@example.com', password: RIGHT_PASSWORD });
      expect(refused.status).toBe(429);
    });

    it('keeps the counters in Redis under the agreed key names', async () => {
      const app = buildLoginApp(redisClient);
      await request(app).post('/login').send({ email: 'Key@Example.com ', password: 'wrong' });
      const keys = (await redisClient.keys('rl:login:*')).sort();
      expect(keys).toContain('rl:login:email:key@example.com');
      expect(keys.some((key) => key.startsWith('rl:login:ip:'))).toBe(true);
    });
  });

  describe('when Redis cannot be reached', () => {
    it('lets logins through instead of failing them (fail open)', async () => {
      // Nothing listens on port 1, so every command fails.
      const brokenClient = createRedisClient('redis://127.0.0.1:1');
      const app = buildLoginApp(brokenClient);
      try {
        // Fail FAST: a command must be rejected at once, not queued while
        // Redis is unreachable (a queue would make every login wait).
        const startedAt = Date.now();
        const wrong = await request(app).post('/login').send({ email: 'z@example.com', password: 'wrong' });
        expect(Date.now() - startedAt).toBeLessThan(150);
        expect(wrong.status).toBe(401);
        const right = await request(app).post('/login').send({ email: 'z@example.com', password: RIGHT_PASSWORD });
        expect(right.status).toBe(200);
      } finally {
        brokenClient.disconnect();
      }
    });
  });
});
