import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../lib/redis.js';
import { createRedisPresenceStore, RedisPresenceStore } from '../lib/redisPresenceStore.js';
import type { PresenceEntry } from '../lib/presence.js';

// CONCEPT: redis-presence-store. These tests need a REAL Redis, so they are
// skipped unless TEST_REDIS_URL is set. They never run in CI. Several stores
// sharing one Redis stand in for several servers.
const testRedisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = testRedisUrl ? describe : describe.skip;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntilReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return;
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));
}

const ali: PresenceEntry = { _id: 'user-ali', name: 'Ali', role: 'admin' };
const sara: PresenceEntry = { _id: 'user-sara', name: 'Sara', role: 'client' };
const PROJECT = 'project-1';

describeWithRedis('presence store in Redis', () => {
  let redisClient: Redis;
  const openStores: RedisPresenceStore[] = [];

  // Each call is one "server". The heartbeat is slow unless a test asks otherwise.
  function newServer(serverId: string, options: { serverTtlMs?: number; heartbeatIntervalMs?: number } = {}, client = redisClient) {
    const store = createRedisPresenceStore(client, { serverId, heartbeatIntervalMs: 60_000, ...options });
    openStores.push(store);
    return store;
  }

  beforeAll(async () => {
    redisClient = createRedisClient(testRedisUrl as string);
    await waitUntilReady(redisClient);
  });

  beforeEach(async () => {
    await redisClient.flushdb();
  });

  afterEach(async () => {
    await Promise.all(openStores.splice(0).map((store) => store.close()));
  });

  afterAll(async () => {
    await redisClient.quit();
  });

  describe('one server', () => {
    it('the first socket of a person makes them present, extra sockets do not', async () => {
      const server = newServer('A');
      expect(await server.add(PROJECT, ali, 'socket-1')).toBe(true);
      expect(await server.add(PROJECT, ali, 'socket-2')).toBe(false);
      // the same socket joining twice is not a new socket
      expect(await server.add(PROJECT, ali, 'socket-2')).toBe(false);
    });

    it('a person is gone only when their LAST socket leaves, and remove returns who left', async () => {
      const server = newServer('A');
      await server.add(PROJECT, ali, 'socket-1');
      await server.add(PROJECT, ali, 'socket-2');
      expect(await server.remove(PROJECT, ali._id, 'socket-1')).toBeNull();
      expect(await server.list(PROJECT)).toEqual([ali]);
      expect(await server.remove(PROJECT, ali._id, 'socket-2')).toEqual(ali);
      expect(await server.list(PROJECT)).toEqual([]);
    });

    it('leaves nothing behind in Redis once everyone has left', async () => {
      const server = newServer('A');
      await server.add(PROJECT, ali, 'socket-1');
      await server.add(PROJECT, sara, 'socket-2');
      await server.remove(PROJECT, ali._id, 'socket-1');
      await server.remove(PROJECT, sara._id, 'socket-2');
      // Only the server's own heartbeat key remains.
      expect(await redisClient.keys('presence:*')).toEqual(['presence:server:A']);
    });

    it('removing a socket that was never added changes nothing and reports nobody', async () => {
      const server = newServer('A');
      expect(await server.remove(PROJECT, ali._id, 'unknown')).toBeNull();
      await server.add(PROJECT, ali, 'socket-1');
      expect(await server.remove(PROJECT, ali._id, 'unknown')).toBeNull();
      expect(await server.list(PROJECT)).toEqual([ali]);
    });

    it('list returns every person present, with name and role, per project', async () => {
      const server = newServer('A');
      await server.add(PROJECT, ali, 'socket-1');
      await server.add(PROJECT, sara, 'socket-2');
      await server.add('project-2', ali, 'socket-3');
      const inProjectOne = await server.list(PROJECT);
      expect(inProjectOne).toHaveLength(2);
      expect(inProjectOne).toEqual(expect.arrayContaining([ali, sara]));
      expect(await server.list('project-2')).toEqual([ali]);
      expect(await server.list('project-3')).toEqual([]);
    });

    it('presence in one project does not affect another project', async () => {
      const server = newServer('A');
      await server.add(PROJECT, ali, 'socket-1');
      await server.add('project-2', ali, 'socket-1');
      expect(await server.remove(PROJECT, ali._id, 'socket-1')).toEqual(ali);
      expect(await server.list('project-2')).toEqual([ali]);
    });
  });

  describe('two servers sharing one Redis', () => {
    it('each server sees the people connected through the other', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await serverB.add(PROJECT, sara, 'socket-b1');
      for (const server of [serverA, serverB]) {
        const present = await server.list(PROJECT);
        expect(present).toHaveLength(2);
        expect(present).toEqual(expect.arrayContaining([ali, sara]));
      }
    });

    it('one person with a tab on each server counts once, and is gone only when both close', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      expect(await serverA.add(PROJECT, ali, 'socket-a1')).toBe(true);
      expect(await serverB.add(PROJECT, ali, 'socket-b1')).toBe(false);
      expect(await serverA.remove(PROJECT, ali._id, 'socket-a1')).toBeNull();
      expect(await serverB.list(PROJECT)).toEqual([ali]);
      expect(await serverB.remove(PROJECT, ali._id, 'socket-b1')).toEqual(ali);
      expect(await serverA.list(PROJECT)).toEqual([]);
    });

    it('two sockets of the same person joining at the same moment: exactly one is "first"', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      const results = await Promise.all([
        serverA.add(PROJECT, ali, 'socket-a1'),
        serverB.add(PROJECT, ali, 'socket-b1'),
        serverA.add(PROJECT, ali, 'socket-a2'),
        serverB.add(PROJECT, ali, 'socket-b2'),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
    });

    it('the last two sockets leaving at the same moment: exactly one is told "last"', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await serverB.add(PROJECT, ali, 'socket-b1');
      const results = await Promise.all([
        serverA.remove(PROJECT, ali._id, 'socket-a1'),
        serverB.remove(PROJECT, ali._id, 'socket-b1'),
      ]);
      expect(results.filter((result) => result !== null)).toEqual([ali]);
    });
  });

  describe('a server that dies', () => {
    it('its people disappear once its heartbeat is gone, and others stay', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await serverB.add(PROJECT, sara, 'socket-b1');
      // A crash: the heartbeat key is gone (here deleted, in life it expires).
      await redisClient.del('presence:server:A');
      expect(await serverB.list(PROJECT)).toEqual([sara]);
    });

    it('a person whose only sockets were on the dead server is "first" again when they return', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await redisClient.del('presence:server:A');
      expect(await serverB.add(PROJECT, ali, 'socket-b1')).toBe(true);
    });

    it('a person with a socket on a dead server and one on a live server stays present', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await serverB.add(PROJECT, ali, 'socket-b1');
      await redisClient.del('presence:server:A');
      expect(await serverB.list(PROJECT)).toEqual([ali]);
      expect(await serverB.remove(PROJECT, ali._id, 'socket-b1')).toEqual(ali);
    });

    it('when the last live socket leaves, the person is reported gone even though a dead server still lists a socket', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await serverB.add(PROJECT, ali, 'socket-b1');
      await redisClient.del('presence:server:A');
      // No list() in between: remove itself must notice that A is dead.
      expect(await serverB.remove(PROJECT, ali._id, 'socket-b1')).toEqual(ali);
      expect(await serverB.list(PROJECT)).toEqual([]);
    });

    it('the heartbeat key really expires without refreshes', async () => {
      const serverA = newServer('A', { serverTtlMs: 300 });
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      expect(await serverB.list(PROJECT)).toEqual([ali]);
      await wait(450);
      expect(await serverB.list(PROJECT)).toEqual([]);
    });

    it('a running server keeps its people alive by refreshing the heartbeat', async () => {
      const serverA = newServer('A', { serverTtlMs: 300, heartbeatIntervalMs: 100 });
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await wait(700);
      expect(await serverB.list(PROJECT)).toEqual([ali]);
    });

    it('closing a server removes its people at once', async () => {
      const serverA = newServer('A');
      const serverB = newServer('B');
      await serverA.add(PROJECT, ali, 'socket-a1');
      await serverA.close();
      expect(await serverB.list(PROJECT)).toEqual([]);
      expect(await redisClient.exists('presence:server:A')).toBe(0);
    });
  });

  describe('when Redis cannot be reached', () => {
    it('add, remove and list do not throw: presence just goes quiet', async () => {
      const brokenClient = createRedisClient('redis://127.0.0.1:1');
      const server = newServer('A', {}, brokenClient);
      try {
        expect(await server.add(PROJECT, ali, 'socket-1')).toBe(false);
        expect(await server.remove(PROJECT, ali._id, 'socket-1')).toBeNull();
        expect(await server.list(PROJECT)).toEqual([]);
      } finally {
        brokenClient.disconnect();
      }
    });

    it('a leave that could not be recorded is retried by the heartbeat', async () => {
      // A client that fails every eval while "down", and works again afterwards.
      let redisIsDown = false;
      const flakyClient = new Proxy(redisClient, {
        get(target, property, receiver) {
          if (property === 'eval') {
            return (...args: unknown[]) =>
              redisIsDown
                ? Promise.reject(new Error('Redis is down'))
                : (target.eval as (...evalArgs: unknown[]) => Promise<unknown>)(...args);
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const server = newServer('A', { heartbeatIntervalMs: 300 }, flakyClient);
      const observer = newServer('B');

      await server.add(PROJECT, ali, 'socket-1');
      redisIsDown = true;
      expect(await server.remove(PROJECT, ali._id, 'socket-1')).toBeNull();
      redisIsDown = false;
      // The leave was lost, so the person is still shown as present ...
      expect(await observer.list(PROJECT)).toEqual([ali]);
      // ... until the next heartbeat retries it.
      await wait(700);
      expect(await observer.list(PROJECT)).toEqual([]);
    });
  });
});
