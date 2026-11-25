import http from 'http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import type { Redis } from 'ioredis';
import { tokenFor, makeTenant, makeProject, makeUser } from './helpers.js';
import { initializeSocket } from '../lib/socket.js';
import { createRedisClient } from '../lib/redis.js';
import { createRedisPresenceStore, RedisPresenceStore } from '../lib/redisPresenceStore.js';

// CONCEPT: redis-presence-store. The presence behaviour seen through a real
// socket server that uses the Redis store. Needs TEST_REDIS_URL; skipped
// otherwise. The full presence rules are covered by presence.test.ts on the
// in-memory store; this file checks the Redis store plugs in.
const testRedisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = testRedisUrl ? describe : describe.skip;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

interface PresenceUser {
  _id: string;
  name: string;
  role: string;
}

describeWithRedis('presence through the socket server with the Redis store', () => {
  let redisClient: Redis;
  let presenceStore: RedisPresenceStore;
  let server: http.Server;
  let port: number;
  const openedSockets: Socket[] = [];

  beforeAll(async () => {
    redisClient = createRedisClient(testRedisUrl as string);
    if (redisClient.status !== 'ready') {
      await new Promise<void>((resolve) => redisClient.once('ready', () => resolve()));
    }
    await redisClient.flushdb();
    presenceStore = createRedisPresenceStore(redisClient, { serverId: 'socket-test' });
    server = http.createServer();
    initializeSocket(server, { presenceStore });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(() => {
    openedSockets.splice(0).forEach((socket) => socket.close());
  });

  afterAll(async () => {
    await presenceStore.close();
    await new Promise((resolve) => server.close(resolve));
    await redisClient.quit();
  });

  function open(user: Parameters<typeof tokenFor>[0]) {
    return new Promise<{ socket: Socket; lists: { users: PresenceUser[] }[]; updates: { status: string; user: PresenceUser }[] }>(
      (resolve, reject) => {
        const socket = connect(`http://127.0.0.1:${port}`, {
          auth: { token: tokenFor(user) },
          transports: ['websocket'],
          reconnection: false,
        });
        const recorder = {
          socket,
          lists: [] as { users: PresenceUser[] }[],
          updates: [] as { status: string; user: PresenceUser }[],
        };
        socket.on('presence:list', (payload) => recorder.lists.push(payload));
        socket.on('presence:update', (payload) => recorder.updates.push(payload));
        socket.on('connect', () => resolve(recorder));
        socket.on('connect_error', reject);
        openedSockets.push(socket);
      },
    );
  }

  it('a joiner gets the people already present, others are told of arrival and departure', async () => {
    const { org, owner } = await makeTenant();
    const admin = await makeUser(org._id, 'admin');
    const project = await makeProject(org._id);

    const ownerConnection = await open(owner);
    ownerConnection.socket.emit('joinProject', String(project._id));
    await wait(400);
    const adminConnection = await open(admin);
    adminConnection.socket.emit('joinProject', String(project._id));
    await wait(400);

    expect(adminConnection.lists[0].users.map((user) => user._id)).toEqual([String(owner._id)]);
    expect(ownerConnection.updates.map((update) => [update.status, update.user._id])).toEqual([['online', String(admin._id)]]);

    adminConnection.socket.close();
    await wait(400);
    expect(ownerConnection.updates.map((update) => update.status)).toEqual(['online', 'offline']);
    expect(await presenceStore.list(String(project._id))).toHaveLength(1);
  });
});
