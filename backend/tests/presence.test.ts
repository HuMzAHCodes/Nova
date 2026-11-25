import http from 'http';
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { tokenFor, makeTenant, makeProject, makeUser } from './helpers.js';
import { initializeSocket } from '../lib/socket.js';
import ClientAccess from '../models/ClientAccess.js';
import User from '../models/User.js';

// CONCEPT: presence. Written BEFORE the implementation. A user is "present"
// in a project while at least one of their sockets has joined that project's
// room. Staff see everyone who is present; clients see only staff, never
// other clients. Several sockets of one user (tabs) count as one person.

let server: http.Server;
let port: number;
const openedSockets: Socket[] = [];

beforeAll(async () => {
  server = http.createServer();
  initializeSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(() => {
  openedSockets.splice(0).forEach((socket) => socket.close());
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

interface PresenceUser {
  _id: string;
  name: string;
  role: string;
}
interface PresenceUpdate {
  projectId: string;
  status: 'online' | 'offline';
  user: PresenceUser;
}
interface PresenceList {
  projectId: string;
  users: PresenceUser[];
}

// A connected test socket that records every presence event it receives.
interface Recorder {
  socket: Socket;
  updates: PresenceUpdate[];
  lists: PresenceList[];
}

function open(user: Parameters<typeof tokenFor>[0]): Promise<Recorder> {
  return new Promise((resolve, reject) => {
    const socket = connect(`http://127.0.0.1:${port}`, {
      auth: { token: tokenFor(user) },
      transports: ['websocket'],
      reconnection: false,
    });
    const recorder: Recorder = { socket, updates: [], lists: [] };
    socket.on('presence:update', (payload: PresenceUpdate) => recorder.updates.push(payload));
    socket.on('presence:list', (payload: PresenceList) => recorder.lists.push(payload));
    socket.on('connect', () => resolve(recorder));
    socket.on('connect_error', reject);
    openedSockets.push(socket);
  });
}

// Joins a project room and waits long enough for the server to answer.
async function join(recorder: Recorder, projectId: unknown) {
  recorder.socket.emit('joinProject', String(projectId));
  await wait(350);
}

async function scenario() {
  const tenant = await makeTenant();
  const admin = await makeUser(tenant.org._id, 'admin');
  const project = await makeProject(tenant.org._id);
  const otherProject = await makeProject(tenant.org._id, 'Other project');
  const clientOne = await makeUser(tenant.org._id, 'client');
  const clientTwo = await makeUser(tenant.org._id, 'client');
  for (const client of [clientOne, clientTwo]) {
    await ClientAccess.create({
      userId: client._id,
      organizationId: tenant.org._id,
      projectId: project._id,
      permissions: ['view'],
    });
  }
  const outsider = await makeTenant();
  return { ...tenant, admin, project, otherProject, clientOne, clientTwo, outsider };
}

describe('presence: the list sent when you join', () => {
  it('a joiner receives the other people already present, not themselves', async () => {
    const { owner, admin, project } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const adminSocket = await open(admin);
    await join(adminSocket, project._id);

    expect(adminSocket.lists).toHaveLength(1);
    expect(adminSocket.lists[0].projectId).toBe(String(project._id));
    expect(adminSocket.lists[0].users.map((user) => user._id)).toEqual([String(owner._id)]);
    expect(adminSocket.lists[0].users[0]).toEqual({ _id: String(owner._id), name: owner.name, role: 'owner' });
    // The first person to arrive gets an empty list.
    expect(ownerSocket.lists[0].users).toEqual([]);
  });

  it('staff see clients in the list; clients see staff only', async () => {
    const { owner, project, clientOne, clientTwo } = await scenario();
    const clientOneSocket = await open(clientOne);
    await join(clientOneSocket, project._id);
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const clientTwoSocket = await open(clientTwo);
    await join(clientTwoSocket, project._id);

    expect(ownerSocket.lists[0].users.map((user) => user._id)).toEqual([String(clientOne._id)]);
    // Client two arrives last: sees the owner, never client one.
    expect(clientTwoSocket.lists[0].users.map((user) => user._id)).toEqual([String(owner._id)]);
  });

  it('the list contains only people present in THAT project', async () => {
    const { owner, admin, project, otherProject } = await scenario();
    const adminSocket = await open(admin);
    await join(adminSocket, otherProject._id);
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);

    expect(ownerSocket.lists[0].users).toEqual([]);
  });
});

describe('presence: updates while you are in the project', () => {
  it('everyone present is told when a staff member arrives', async () => {
    const { owner, admin, project, clientOne } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const clientSocket = await open(clientOne);
    await join(clientSocket, project._id);
    ownerSocket.updates.length = 0;
    clientSocket.updates.length = 0;

    const adminSocket = await open(admin);
    await join(adminSocket, project._id);

    for (const watcher of [ownerSocket, clientSocket]) {
      expect(watcher.updates).toHaveLength(1);
      expect(watcher.updates[0]).toEqual({
        projectId: String(project._id),
        status: 'online',
        user: { _id: String(admin._id), name: admin.name, role: 'admin' },
      });
    }
    // The person who arrived is not told about their own arrival.
    expect(adminSocket.updates).toEqual([]);
  });

  it('a client arrival is sent to staff only, never to other clients', async () => {
    const { owner, project, clientOne, clientTwo } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const clientTwoSocket = await open(clientTwo);
    await join(clientTwoSocket, project._id);
    ownerSocket.updates.length = 0;
    clientTwoSocket.updates.length = 0;

    const clientOneSocket = await open(clientOne);
    await join(clientOneSocket, project._id);

    expect(ownerSocket.updates.map((update) => update.user._id)).toEqual([String(clientOne._id)]);
    expect(clientTwoSocket.updates).toEqual([]);
  });

  it('a second tab of someone already present changes nothing', async () => {
    const { owner, admin, project } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const firstAdminTab = await open(admin);
    await join(firstAdminTab, project._id);
    ownerSocket.updates.length = 0;

    const secondAdminTab = await open(admin);
    await join(secondAdminTab, project._id);

    expect(ownerSocket.updates).toEqual([]);
  });

  it('joining the same project twice from one socket changes nothing', async () => {
    const { owner, admin, project } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const adminSocket = await open(admin);
    await join(adminSocket, project._id);
    ownerSocket.updates.length = 0;

    await join(adminSocket, project._id);

    expect(ownerSocket.updates).toEqual([]);
  });

  it('going offline is announced only when the LAST socket of that person closes', async () => {
    const { owner, admin, project } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const firstAdminTab = await open(admin);
    await join(firstAdminTab, project._id);
    const secondAdminTab = await open(admin);
    await join(secondAdminTab, project._id);
    ownerSocket.updates.length = 0;

    firstAdminTab.socket.close();
    await wait(350);
    expect(ownerSocket.updates).toEqual([]);

    secondAdminTab.socket.close();
    await wait(350);
    expect(ownerSocket.updates).toEqual([
      {
        projectId: String(project._id),
        status: 'offline',
        user: { _id: String(admin._id), name: admin.name, role: 'admin' },
      },
    ]);
  });

  it('a client going offline is announced to staff only', async () => {
    const { owner, project, clientOne, clientTwo } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    const clientOneSocket = await open(clientOne);
    await join(clientOneSocket, project._id);
    const clientTwoSocket = await open(clientTwo);
    await join(clientTwoSocket, project._id);
    ownerSocket.updates.length = 0;
    clientTwoSocket.updates.length = 0;

    clientOneSocket.socket.close();
    await wait(350);

    expect(ownerSocket.updates.map((update) => `${update.status}:${update.user._id}`)).toEqual([
      `offline:${clientOne._id}`,
    ]);
    expect(clientTwoSocket.updates).toEqual([]);
  });

  it('a person present in two projects goes offline in both when the socket closes', async () => {
    const { owner, admin, project, otherProject } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    await join(ownerSocket, otherProject._id);
    const adminSocket = await open(admin);
    await join(adminSocket, project._id);
    await join(adminSocket, otherProject._id);
    ownerSocket.updates.length = 0;

    adminSocket.socket.close();
    await wait(350);

    expect(ownerSocket.updates.map((update) => `${update.status}:${update.projectId}`).sort()).toEqual(
      [`offline:${project._id}`, `offline:${otherProject._id}`].sort()
    );
  });
});

describe('presence: nothing leaks to people who are not allowed in', () => {
  it('a refused join gives no list and does not make the person present', async () => {
    const { owner, project, outsider } = await scenario();
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    ownerSocket.updates.length = 0;

    const outsiderSocket = await open(outsider.owner);
    await join(outsiderSocket, project._id);

    expect(outsiderSocket.lists).toEqual([]);
    expect(ownerSocket.updates).toEqual([]);
  });

  it('a client without a grant gets no list and is never shown to staff', async () => {
    const { owner, project, org } = await scenario();
    const clientWithoutGrant = await makeUser(org._id, 'client');
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    ownerSocket.updates.length = 0;

    const strangerSocket = await open(clientWithoutGrant);
    await join(strangerSocket, project._id);

    expect(strangerSocket.lists).toEqual([]);
    expect(ownerSocket.updates).toEqual([]);
  });

  it('an invalid project id does nothing and does not crash the server', async () => {
    const { owner, project } = await scenario();
    const ownerSocket = await open(owner);
    ownerSocket.socket.emit('joinProject', 'not-an-id');
    ownerSocket.socket.emit('joinProject', { bad: 'payload' });
    await wait(300);
    expect(ownerSocket.lists).toEqual([]);

    await join(ownerSocket, project._id);
    expect(ownerSocket.lists).toHaveLength(1);
  });

  it('a socket that closes while its arrival is still being recorded leaves no ghost behind', async () => {
    const { owner, admin, project } = await scenario();

    // Slow down the name lookup (the step between "join allowed" and "recorded
    // as present") so the socket reliably closes inside that gap.
    const realFindById = User.findById.bind(User);
    const slowLookup = vi.spyOn(User, 'findById').mockImplementation(((userId: string) => ({
      select: async (fields: string) => {
        await wait(400);
        return realFindById(userId).select(fields);
      },
    })) as never);

    try {
      const adminSocket = await open(admin);
      adminSocket.socket.emit('joinProject', String(project._id));
      await wait(100);
      adminSocket.socket.close();
      await wait(700);
    } finally {
      slowLookup.mockRestore();
    }

    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);
    expect(ownerSocket.lists[0].users).toEqual([]);
  });

  it('a person from another organization never appears in this project', async () => {
    const { owner, project, outsider } = await scenario();
    const outsiderProject = await makeProject(outsider.org._id);
    const outsiderSocket = await open(outsider.owner);
    await join(outsiderSocket, outsiderProject._id);
    const ownerSocket = await open(owner);
    await join(ownerSocket, project._id);

    expect(ownerSocket.lists[0].users).toEqual([]);
  });
});
