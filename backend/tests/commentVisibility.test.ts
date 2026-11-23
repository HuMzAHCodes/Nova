import http from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { api, bearer, tokenFor, makeTenant, makeProject, makeUser } from './helpers.js';
import { initializeSocket } from '../lib/socket.js';
import ClientAccess from '../models/ClientAccess.js';
import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import Task from '../models/Task.js';

// CONCEPT: comment-visibility. Written BEFORE the implementation. Staff
// comments are internal by default; clients see only shared comments on
// deliverables of projects they hold a grant for.

let server: http.Server;
let port: number;

beforeAll(async () => {
  server = http.createServer();
  initializeSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

type Authenticated = Parameters<typeof bearer>[0];

// An organization with staff, a deliverable, a normal task and three clients:
// one with a view-only grant, one without any grant, and the outsider's world.
async function scenario() {
  const tenant = await makeTenant();
  const admin = await makeUser(tenant.org._id, 'admin');
  const member = await makeUser(tenant.org._id, 'member');
  const project = await makeProject(tenant.org._id);
  const deliverable = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Logo deliverable',
    isDeliverable: true,
    approvalStatus: 'pending',
    assignedTo: [member._id],
  });
  const normalTask = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Internal chore',
  });
  const client = await makeUser(tenant.org._id, 'client');
  await ClientAccess.create({
    userId: client._id,
    organizationId: tenant.org._id,
    projectId: project._id,
    permissions: ['view'], // view-only: commenting is still allowed
  });
  const clientWithoutGrant = await makeUser(tenant.org._id, 'client');
  const outsider = await makeTenant();
  return { ...tenant, admin, member, project, deliverable, normalTask, client, clientWithoutGrant, outsider };
}

const staffPost = (task: { _id: unknown }, user: Authenticated, body: unknown) =>
  api().post(`/api/tasks/${task._id}/comments`).set(bearer(user)).send(body as object);
const clientPost = (task: { _id: unknown }, user: Authenticated, body: unknown) =>
  api().post(`/api/client/tasks/${task._id}/comments`).set(bearer(user)).send(body as object);
const clientList = (task: { _id: unknown }, user: Authenticated) =>
  api().get(`/api/client/tasks/${task._id}/comments`).set(bearer(user));

describe('comment visibility: what is stored', () => {
  it('a staff comment is internal by default', async () => {
    const { deliverable, member } = await scenario();
    const res = await staffPost(deliverable, member, { body: 'Between us' });
    expect(res.status).toBe(201);
    expect(res.body.data.comment.visibility).toBe('internal');
  });

  it('staff can share a comment on a deliverable', async () => {
    const { deliverable, member } = await scenario();
    const res = await staffPost(deliverable, member, { body: 'For the client', visibility: 'shared' });
    expect(res.body.data.comment.visibility).toBe('shared');
  });

  it('a shared comment on a task that is not a deliverable is stored internal', async () => {
    const { normalTask, member } = await scenario();
    const res = await staffPost(normalTask, member, { body: 'Clients cannot see this task', visibility: 'shared' });
    expect(res.status).toBe(201);
    expect(res.body.data.comment.visibility).toBe('internal');
  });

  it('an unknown visibility value is a 400', async () => {
    const { deliverable, member } = await scenario();
    const res = await staffPost(deliverable, member, { body: 'x', visibility: 'secret' });
    expect(res.status).toBe(400);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('a client comment is always shared, whatever the request says, and a view-only grant is enough', async () => {
    const { deliverable, client } = await scenario();
    for (const forged of [{}, { visibility: 'internal' }, { visibility: 'shared' }, { visibility: 'secret' }]) {
      const res = await clientPost(deliverable, client, { body: 'Hello', ...forged });
      expect(res.status).toBe(201);
      expect(res.body.data.comment.visibility).toBe('shared');
      expect(res.body.data.comment.authorRole).toBe('client');
    }
  });

  it('visibility cannot be changed by an edit', async () => {
    const { deliverable, member } = await scenario();
    const created = await staffPost(deliverable, member, { body: 'Private' });
    const res = await api()
      .patch(`/api/comments/${created.body.data.comment._id}`)
      .set(bearer(member))
      .send({ body: 'Still private', visibility: 'shared' });
    expect(res.status).toBe(200);
    expect(res.body.data.comment.visibility).toBe('internal');
    expect((await Comment.findById(created.body.data.comment._id))?.visibility).toBe('internal');
  });
});

describe('comment visibility: what a client can read', () => {
  it('the client list and its total never include internal comments', async () => {
    const { deliverable, member, client } = await scenario();
    await staffPost(deliverable, member, { body: 'Internal one' });
    await staffPost(deliverable, member, { body: 'Internal two' });
    await staffPost(deliverable, member, { body: 'Shared one', visibility: 'shared' });

    const res = await clientList(deliverable, client);

    expect(res.status).toBe(200);
    expect(res.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['Shared one']);
    expect(res.body.pagination.total).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('Internal');
  });

  it('staff see both kinds', async () => {
    const { deliverable, member, owner } = await scenario();
    await staffPost(deliverable, member, { body: 'Internal one' });
    await staffPost(deliverable, member, { body: 'Shared one', visibility: 'shared' });
    const res = await api().get(`/api/tasks/${deliverable._id}/comments`).set(bearer(owner));
    expect(res.body.pagination.total).toBe(2);
  });

  it('a client without a grant, a client of another organization, and a normal task all answer 404', async () => {
    const { deliverable, normalTask, client, clientWithoutGrant, outsider } = await scenario();
    const outsiderClient = await makeUser(outsider.org._id, 'client');

    expect((await clientList(deliverable, clientWithoutGrant)).status).toBe(404);
    expect((await clientPost(deliverable, clientWithoutGrant, { body: 'Hi' })).status).toBe(404);
    expect((await clientList(deliverable, outsiderClient)).status).toBe(404);
    expect((await clientList(normalTask, client)).status).toBe(404);
    expect((await clientPost(normalTask, client, { body: 'Hi' })).status).toBe(404);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('staff endpoints refuse clients and client endpoints refuse staff', async () => {
    const { deliverable, client, member } = await scenario();
    expect((await api().get(`/api/tasks/${deliverable._id}/comments`).set(bearer(client))).status).toBe(403);
    expect((await staffPost(deliverable, client, { body: 'Hi' })).status).toBe(403);
    expect((await clientList(deliverable, member)).status).toBe(403);
    expect((await clientPost(deliverable, member, { body: 'Hi' })).status).toBe(403);
  });
});

describe('comment visibility: clients editing and deleting', () => {
  it('a client can edit and delete their own comment', async () => {
    const { deliverable, client } = await scenario();
    const created = await clientPost(deliverable, client, { body: 'Original' });
    const commentId = created.body.data.comment._id;

    const edited = await api().patch(`/api/client/comments/${commentId}`).set(bearer(client)).send({ body: 'Changed' });
    expect(edited.status).toBe(200);
    expect((await Comment.findById(commentId))?.body).toBe('Changed');

    const deleted = await api().delete(`/api/client/comments/${commentId}`).set(bearer(client));
    expect(deleted.status).toBe(204);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('a client cannot edit or delete a staff comment, even a shared one they can read', async () => {
    const { deliverable, member, client } = await scenario();
    const created = await staffPost(deliverable, member, { body: 'Staff words', visibility: 'shared' });
    const commentId = created.body.data.comment._id;

    expect((await api().patch(`/api/client/comments/${commentId}`).set(bearer(client)).send({ body: 'Hijack' })).status).toBe(404);
    expect((await api().delete(`/api/client/comments/${commentId}`).set(bearer(client))).status).toBe(404);
    expect((await Comment.findById(commentId))?.body).toBe('Staff words');
  });

  it('a client whose grant was removed can no longer read, edit or delete their comments', async () => {
    const { deliverable, client } = await scenario();
    const created = await clientPost(deliverable, client, { body: 'Mine' });
    const commentId = created.body.data.comment._id;
    await ClientAccess.deleteMany({ userId: client._id });

    expect((await clientList(deliverable, client)).status).toBe(404);
    expect((await api().patch(`/api/client/comments/${commentId}`).set(bearer(client)).send({ body: 'Late' })).status).toBe(404);
    expect((await api().delete(`/api/client/comments/${commentId}`).set(bearer(client))).status).toBe(404);
    expect((await Comment.findById(commentId))?.body).toBe('Mine');
  });

  it('staff cannot be confused with clients: an admin can still delete a client comment', async () => {
    const { deliverable, client, admin } = await scenario();
    const created = await clientPost(deliverable, client, { body: 'Moderate me' });
    const res = await api().delete(`/api/comments/${created.body.data.comment._id}`).set(bearer(admin));
    expect(res.status).toBe(204);
  });
});

describe('comment visibility: live events', () => {
  const open = (token: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = connect(`http://127.0.0.1:${port}`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', reject);
    });

  const eventNames = ['comment:created', 'comment:updated', 'comment:deleted'];

  it('a granted client receives shared events and never internal ones; staff receive each exactly once', async () => {
    const { deliverable, project, member, owner, client, clientWithoutGrant } = await scenario();
    const staffSocket = await open(tokenFor(owner));
    const clientSocket = await open(tokenFor(client));
    const strangerSocket = await open(tokenFor(clientWithoutGrant));
    const staffEvents: string[] = [];
    const clientEvents: string[] = [];
    let strangerEvents = 0;
    for (const eventName of eventNames) {
      staffSocket.on(eventName, () => staffEvents.push(eventName));
      clientSocket.on(eventName, () => clientEvents.push(eventName));
      strangerSocket.on(eventName, () => (strangerEvents += 1));
    }
    for (const socket of [staffSocket, clientSocket, strangerSocket]) {
      socket.emit('joinProject', String(project._id));
    }
    await wait(400);

    // An internal comment: staff only.
    const internal = await staffPost(deliverable, member, { body: 'Secret plan' });
    await api().patch(`/api/comments/${internal.body.data.comment._id}`).set(bearer(member)).send({ body: 'Secret plan v2' });
    await api().delete(`/api/comments/${internal.body.data.comment._id}`).set(bearer(member));
    await wait(400);
    expect(clientEvents).toEqual([]);
    expect(staffEvents).toEqual(eventNames);

    // A shared comment: staff and the granted client, each exactly once.
    staffEvents.length = 0;
    const shared = await staffPost(deliverable, member, { body: 'Hello client', visibility: 'shared' });
    await api().patch(`/api/comments/${shared.body.data.comment._id}`).set(bearer(member)).send({ body: 'Hello again' });
    await api().delete(`/api/comments/${shared.body.data.comment._id}`).set(bearer(member));
    await wait(500);
    [staffSocket, clientSocket, strangerSocket].forEach((socket) => socket.close());

    expect(staffEvents).toEqual(eventNames);
    expect(clientEvents).toEqual(eventNames);
    expect(strangerEvents).toBe(0);
  });

  it('a comment written by a client reaches staff and that client', async () => {
    const { deliverable, project, owner, client } = await scenario();
    const staffSocket = await open(tokenFor(owner));
    const clientSocket = await open(tokenFor(client));
    let staffGot = 0;
    let clientGot = 0;
    staffSocket.on('comment:created', () => (staffGot += 1));
    clientSocket.on('comment:created', () => (clientGot += 1));
    staffSocket.emit('joinProject', String(project._id));
    clientSocket.emit('joinProject', String(project._id));
    await wait(400);

    await clientPost(deliverable, client, { body: 'From the client' });
    await wait(400);
    staffSocket.close();
    clientSocket.close();

    expect(staffGot).toBe(1);
    expect(clientGot).toBe(1);
  });
});

describe('comment visibility: notifications', () => {
  it('an internal comment never notifies a client, even one who commented earlier', async () => {
    const { deliverable, member, admin, client } = await scenario();
    await clientPost(deliverable, client, { body: 'Client says hi' });
    await Notification.deleteMany({});

    await staffPost(deliverable, admin, { body: 'Internal reply' });

    expect(await Notification.countDocuments({ userId: client._id })).toBe(0);
    expect(await Notification.countDocuments({ userId: member._id })).toBe(1); // the assignee is told
  });

  it('a shared comment notifies an earlier client commenter who still holds a grant', async () => {
    const { deliverable, admin, client } = await scenario();
    await clientPost(deliverable, client, { body: 'Client says hi' });
    await Notification.deleteMany({});

    await staffPost(deliverable, admin, { body: 'Shared reply', visibility: 'shared' });

    const stored = await Notification.findOne({ userId: client._id });
    expect(stored?.type).toBe('comment_added');
    expect(stored?.message).not.toContain('Shared reply');
  });

  it('a client whose grant was removed is not notified', async () => {
    const { deliverable, admin, client } = await scenario();
    await clientPost(deliverable, client, { body: 'Client says hi' });
    await ClientAccess.deleteMany({ userId: client._id });
    await Notification.deleteMany({});

    await staffPost(deliverable, admin, { body: 'Shared reply', visibility: 'shared' });

    expect(await Notification.countDocuments({ userId: client._id })).toBe(0);
  });

  it('a client who lost this project but holds a grant on another one is not notified', async () => {
    const { deliverable, admin, client, org } = await scenario();
    await clientPost(deliverable, client, { body: 'Client says hi' });
    // The grant for this project is replaced by a grant on a different project.
    await ClientAccess.deleteMany({ userId: client._id });
    const otherProject = await makeProject(org._id, 'Other project');
    await ClientAccess.create({
      userId: client._id,
      organizationId: org._id,
      projectId: otherProject._id,
      permissions: ['view'],
    });
    await Notification.deleteMany({});

    await staffPost(deliverable, admin, { body: 'Shared reply', visibility: 'shared' });

    expect(await Notification.countDocuments({ userId: client._id })).toBe(0);
  });

  it('a comment from a client notifies the assignee, the owner and the admin, never the client', async () => {
    const { deliverable, member, owner, admin, client } = await scenario();

    await clientPost(deliverable, client, { body: 'Can the logo be bigger?' });

    const recipients = (await Notification.find({ type: 'comment_added' })).map((n) => String(n.userId)).sort();
    expect(recipients).toEqual([String(member._id), String(owner._id), String(admin._id)].sort());
  });
});
