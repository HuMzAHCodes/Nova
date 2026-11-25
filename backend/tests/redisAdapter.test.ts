import http from 'http';
import jwt from 'jsonwebtoken';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import type { Server } from 'socket.io';
import type { Redis } from 'ioredis';
import { tokenFor, makeTenant, makeProject, makeUser } from './helpers.js';
import { initializeSocket, disconnectSessions } from '../lib/socket.js';
import { createRedisClient, createRedisSubscriber } from '../lib/redis.js';
import { createRedisAdapterHandle, RedisAdapterHandle } from '../lib/redisAdapter.js';
import { createRedisPresenceStore, RedisPresenceStore } from '../lib/redisPresenceStore.js';

// CONCEPT: socketio-redis-adapter. Two real Socket.io servers in one
// process, on different ports, sharing one Redis, stand in for two backend
// instances behind a load balancer. These tests need a REAL Redis, so they
// are skipped unless TEST_REDIS_URL is set. They never run in CI.
const testRedisUrl = process.env.TEST_REDIS_URL;
const describeWithRedis = testRedisUrl ? describe : describe.skip;

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitUntilReady(client: Redis): Promise<void> {
  if (client.status === 'ready') return;
  await new Promise<void>((resolve) => client.once('ready', () => resolve()));
}

interface TestServer {
  io: Server;
  httpServer: http.Server;
  port: number;
  adapter: RedisAdapterHandle | null;
  presenceStore: RedisPresenceStore;
}

interface Recorder {
  socket: Socket;
  events: { name: string; payload: unknown }[];
}

describeWithRedis('Socket.io Redis adapter: two servers, one Redis', () => {
  let publisher: Redis;
  const startedServers: TestServer[] = [];
  const openedSockets: Socket[] = [];
  const subscribers: Redis[] = [];

  // Starts one "server". withAdapter=false is the setup without Redis sharing.
  async function startServer(serverId: string, withAdapter: boolean, publisherClient = publisher): Promise<TestServer> {
    let adapter: RedisAdapterHandle | null = null;
    if (withAdapter) {
      const subscriber = createRedisSubscriber(testRedisUrl as string);
      subscribers.push(subscriber);
      adapter = createRedisAdapterHandle(publisherClient, subscriber);
    }
    const presenceStore = createRedisPresenceStore(publisher, { serverId, heartbeatIntervalMs: 60_000 });
    const httpServer = http.createServer();
    const io = initializeSocket(httpServer, { presenceStore, redisAdapter: adapter });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as { port: number }).port;
    const started = { io, httpServer, port, adapter, presenceStore };
    startedServers.push(started);
    return started;
  }

  function open(server: TestServer, user: Parameters<typeof tokenFor>[0], eventNames: string[] = []): Promise<Recorder> {
    return new Promise((resolve, reject) => {
      const socket = connect(`http://127.0.0.1:${server.port}`, {
        auth: { token: tokenFor(user) },
        transports: ['websocket'],
        reconnection: false,
      });
      const recorder: Recorder = { socket, events: [] };
      for (const eventName of ['presence:list', 'presence:update', ...eventNames]) {
        socket.on(eventName, (payload: unknown) => recorder.events.push({ name: eventName, payload }));
      }
      socket.on('connect', () => resolve(recorder));
      socket.on('connect_error', reject);
      openedSockets.push(socket);
    });
  }

  async function join(recorder: Recorder, projectId: unknown) {
    recorder.socket.emit('joinProject', String(projectId));
    await wait(450);
  }

  const eventsNamed = (recorder: Recorder, name: string) => recorder.events.filter((event) => event.name === name);

  beforeAll(async () => {
    publisher = createRedisClient(testRedisUrl as string);
    await waitUntilReady(publisher);
  });

  beforeEach(async () => {
    await publisher.flushdb();
  });

  afterEach(async () => {
    openedSockets.splice(0).forEach((socket) => socket.close());
    for (const started of startedServers.splice(0)) {
      await started.presenceStore.close();
      await started.io.close();
    }
    subscribers.splice(0).forEach((subscriber) => subscriber.disconnect());
  });

  afterAll(async () => {
    await publisher.quit();
  });

  async function scenario() {
    const tenant = await makeTenant();
    const admin = await makeUser(tenant.org._id, 'admin');
    const project = await makeProject(tenant.org._id);
    return { ...tenant, admin, project };
  }

  describe('events between servers', () => {
    it('an event emitted on server B reaches a client connected to server A, and a client on B exactly once', async () => {
      const { owner, admin, project } = await scenario();
      const serverA = await startServer('A', true);
      const serverB = await startServer('B', true);
      const clientOnA = await open(serverA, owner, ['test:event']);
      const clientOnB = await open(serverB, admin, ['test:event']);
      await join(clientOnA, project._id);
      await join(clientOnB, project._id);

      serverB.io.to(`project:${project._id}`).emit('test:event', { value: 42 });
      await wait(400);

      expect(eventsNamed(clientOnA, 'test:event')).toEqual([{ name: 'test:event', payload: { value: 42 } }]);
      expect(eventsNamed(clientOnB, 'test:event')).toHaveLength(1);
    });

    it('a room only receives its own events, across servers', async () => {
      const { owner, admin, project } = await scenario();
      const otherProject = await makeProject(project.organizationId, 'Other project');
      const serverA = await startServer('A', true);
      const serverB = await startServer('B', true);
      const clientOnA = await open(serverA, owner, ['test:event']);
      const adminOnB = await open(serverB, admin, ['test:event']);
      await join(clientOnA, project._id);
      await join(adminOnB, otherProject._id);

      serverB.io.to(`project:${otherProject._id}`).emit('test:event', { value: 1 });
      await wait(400);

      expect(eventsNamed(clientOnA, 'test:event')).toHaveLength(0);
      expect(eventsNamed(adminOnB, 'test:event')).toHaveLength(1);
    });

    it('WITHOUT the adapter the client on the other server never hears the event (the problem it solves)', async () => {
      const { owner, admin, project } = await scenario();
      const serverA = await startServer('A', false);
      const serverB = await startServer('B', false);
      const clientOnA = await open(serverA, owner, ['test:event']);
      const clientOnB = await open(serverB, admin, ['test:event']);
      await join(clientOnA, project._id);
      await join(clientOnB, project._id);

      serverB.io.to(`project:${project._id}`).emit('test:event', { value: 42 });
      await wait(400);

      expect(eventsNamed(clientOnA, 'test:event')).toHaveLength(0);
      expect(eventsNamed(clientOnB, 'test:event')).toHaveLength(1);
    });
  });

  describe('each server uses its own Socket.io instance', () => {
    it('without the adapter, presence updates still reach people on the SAME server as the one who left', async () => {
      const { owner, admin, project } = await scenario();
      const serverA = await startServer('A', false);
      // Started last, so the module-level server variable points at B, not A.
      await startServer('B', false);
      const watcher = await open(serverA, owner);
      await join(watcher, project._id);
      const adminOnA = await open(serverA, admin);
      await join(adminOnA, project._id);
      adminOnA.socket.close();
      await wait(450);

      expect(eventsNamed(watcher, 'presence:update').map((event) => (event.payload as { status: string }).status)).toEqual(['online', 'offline']);
    });
  });

  describe('presence across servers', () => {
    it('each person sees the other in the list and in the live updates, whichever server they are on', async () => {
      const { owner, admin, project } = await scenario();
      const serverA = await startServer('A', true);
      const serverB = await startServer('B', true);

      const ownerOnA = await open(serverA, owner);
      await join(ownerOnA, project._id);
      const adminOnB = await open(serverB, admin);
      await join(adminOnB, project._id);

      // The list sent to the second person comes from the shared store.
      const listForAdmin = eventsNamed(adminOnB, 'presence:list')[0].payload as { users: { _id: string }[] };
      expect(listForAdmin.users.map((user) => user._id)).toEqual([String(owner._id)]);
      // The live "online" update crossed from server B to server A.
      const updatesForOwner = eventsNamed(ownerOnA, 'presence:update').map((event) => event.payload as { status: string; user: { _id: string } });
      expect(updatesForOwner.map((update) => [update.status, update.user._id])).toEqual([['online', String(admin._id)]]);

      adminOnB.socket.close();
      await wait(450);
      const updatesAfterLeaving = eventsNamed(ownerOnA, 'presence:update').map((event) => (event.payload as { status: string }).status);
      expect(updatesAfterLeaving).toEqual(['online', 'offline']);
    });

    it('a person with a tab on each server is announced online once, and offline only when both close', async () => {
      const { owner, admin, project } = await scenario();
      const serverA = await startServer('A', true);
      const serverB = await startServer('B', true);
      const watcher = await open(serverA, owner);
      await join(watcher, project._id);

      const adminOnA = await open(serverA, admin);
      await join(adminOnA, project._id);
      const adminOnB = await open(serverB, admin);
      await join(adminOnB, project._id);
      expect(eventsNamed(watcher, 'presence:update').map((event) => (event.payload as { status: string }).status)).toEqual(['online']);

      adminOnA.socket.close();
      await wait(450);
      expect(eventsNamed(watcher, 'presence:update')).toHaveLength(1);

      adminOnB.socket.close();
      await wait(450);
      expect(eventsNamed(watcher, 'presence:update').map((event) => (event.payload as { status: string }).status)).toEqual(['online', 'offline']);
    });
  });

  describe('closing sockets across servers', () => {
    it('ending a session closes its socket even when that socket is on the other server', async () => {
      const { owner, admin, project } = await scenario();
      const serverA = await startServer('A', true);
      // Started last, so this is the server the module-level helper uses.
      await startServer('B', true);
      const adminOnA = await open(serverA, admin);
      const ownerOnA = await open(serverA, owner);
      await join(adminOnA, project._id);

      const adminSessionId = (jwt.decode(adminOnA.socket.auth && (adminOnA.socket.auth as { token: string }).token) as { sessionId: string }).sessionId;
      disconnectSessions([adminSessionId]);
      await wait(500);

      expect(adminOnA.socket.connected).toBe(false);
      expect(ownerOnA.socket.connected).toBe(true);
    });
  });

  describe('when Redis cannot be reached', () => {
    it('a server whose adapter cannot publish still serves its own sockets and does not crash', async () => {
      const { owner, project } = await scenario();
      const brokenPublisher = createRedisClient('redis://127.0.0.1:1');
      const server = await startServer('A', true, brokenPublisher);
      const client = await open(server, owner, ['test:event']);
      await join(client, project._id);

      // The publish fails; the event must still reach the local client.
      server.io.to(`project:${project._id}`).emit('test:event', { value: 7 });
      await wait(400);

      expect(eventsNamed(client, 'test:event')).toEqual([{ name: 'test:event', payload: { value: 7 } }]);
      brokenPublisher.disconnect();
    });
  });
});
