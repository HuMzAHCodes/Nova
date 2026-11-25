import { vi, describe, it, expect, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { getRedisClient } from '../lib/redis.js';
import { RedisRateLimitStore } from '../lib/redisRateLimitStore.js';

// CONCEPT: redis-rate-limiting. These tests run WITHOUT a Redis server.

describe('Redis is optional', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('getRedisClient returns null when REDIS_URL is not set', () => {
    expect(process.env.REDIS_URL).toBeUndefined();
    expect(getRedisClient()).toBeNull();
  });

  it('an empty REDIS_URL counts as not set', async () => {
    vi.stubEnv('REDIS_URL', '');
    vi.resetModules();
    const freshModule = await import('../lib/redis.js');
    expect(freshModule.getRedisClient()).toBeNull();
  });

  it('with REDIS_URL set, one shared client is created and reused', async () => {
    // Nothing listens on port 1; creating the client must not throw.
    vi.stubEnv('REDIS_URL', 'redis://127.0.0.1:1');
    vi.resetModules();
    const freshModule = await import('../lib/redis.js');
    const firstClient = freshModule.getRedisClient();
    const secondClient = freshModule.getRedisClient();
    expect(firstClient).not.toBeNull();
    expect(secondClient).toBe(firstClient);
    firstClient?.disconnect();
  });
});

describe('RedisRateLimitStore with a stand-in client', () => {
  it('never reports a reset time in the past, even if Redis says the key has no expiry left', async () => {
    // PTTL answers -1 or -2 in a rare race; the store must fall back to a full window.
    const standInClient = { eval: async () => [1, -1] } as unknown as Redis;
    const store = new RedisRateLimitStore(standInClient, 'rl:test:');
    store.init({ windowMs: 60_000 } as never);
    const result = await store.increment('a');
    const msUntilReset = (result.resetTime as Date).getTime() - Date.now();
    expect(msUntilReset).toBeGreaterThan(55_000);
  });
});
