import http from 'http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { api, bearer, tokenFor, makeTenant, makeProject, makeUser } from './helpers.js';
import { initializeSocket } from '../lib/socket.js';
import ClientAccess from '../models/ClientAccess.js';
import Task from '../models/Task.js';
import Notification from '../models/Notification.js';

// CONCEPT: notifications. Written BEFORE the implementation: every test
// here fails until the Notification model, service, routes and the user
// socket room exist.

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

// An organization with an owner, an admin, two members, a project, a client
// who may approve, and one pending deliverable assigned to member A.
async function deliverableScenario() {
  const tenant = await makeTenant();
  const admin = await makeUser(tenant.org._id, 'admin');
  const memberAssigned = await makeUser(tenant.org._id, 'member');
  const memberOther = await makeUser(tenant.org._id, 'member');
  const project = await makeProject(tenant.org._id);
  const client = await makeUser(tenant.org._id, 'client');
  await ClientAccess.create({
    userId: client._id,
    organizationId: tenant.org._id,
    projectId: project._id,
    permissions: ['view', 'approve'],
  });
  const task = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Logo design',
    isDeliverable: true,
    approvalStatus: 'pending',
    assignedTo: [memberAssigned._id],
  });
  return { ...tenant, admin, memberAssigned, memberOther, project, client, task };
}

const recipientIdsOf = async (type: string) =>
  (await Notification.find({ type })).map((notification) => String(notification.userId)).sort();

describe('notifications: deliverable approved or rejected', () => {
  it('approving notifies the assignee, the owner and the admin, nobody else', async () => {
    const scenario = await deliverableScenario();
    const outsiderTenant = await makeTenant();

    const res = await api().post(`/api/client/tasks/${scenario.task._id}/approve`).set(bearer(scenario.client));
    expect(res.status).toBe(200);

    const expected = [scenario.owner._id, scenario.admin._id, scenario.memberAssigned._id].map(String).sort();
    expect(await recipientIdsOf('deliverable_approved')).toEqual(expected);
    // Not the unassigned member, not the client, not another organization.
    expect(await Notification.countDocuments({ userId: scenario.memberOther._id })).toBe(0);
    expect(await Notification.countDocuments({ userId: scenario.client._id })).toBe(0);
    expect(await Notification.countDocuments({ userId: outsiderTenant.owner._id })).toBe(0);

    const stored = await Notification.findOne({ userId: scenario.owner._id });
    expect(stored?.message).toContain('Logo design');
    expect(String(stored?.organizationId)).toBe(scenario.orgId);
    expect(String(stored?.taskId)).toBe(String(scenario.task._id));
    expect(stored?.readAt).toBeUndefined();
  });

  it('rejecting stores the rejected type', async () => {
    const scenario = await deliverableScenario();
    const res = await api()
      .post(`/api/client/tasks/${scenario.task._id}/reject`)
      .set(bearer(scenario.client))
      .send({ feedback: 'Too blue' });
    expect(res.status).toBe(200);
    expect(await Notification.countDocuments({ type: 'deliverable_rejected' })).toBe(3);
    expect(await Notification.countDocuments({ type: 'deliverable_approved' })).toBe(0);
  });

  it('a failure while saving notifications does not fail the approval', async () => {
    const scenario = await deliverableScenario();
    const spy = vi.spyOn(Notification, 'insertMany').mockRejectedValueOnce(new Error('database down'));

    const res = await api().post(`/api/client/tasks/${scenario.task._id}/approve`).set(bearer(scenario.client));

    expect(res.status).toBe(200);
    expect((await Task.findById(scenario.task._id))?.approvalStatus).toBe('approved');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('notifications: task assigned', () => {
  it('creating a task notifies the new assignees but not the person creating it', async () => {
    const scenario = await deliverableScenario();
    const res = await api()
      .post(`/api/projects/${scenario.project._id}/tasks`)
      .set(bearer(scenario.owner))
      .send({ title: 'Write copy', assignedTo: [String(scenario.memberOther._id), String(scenario.owner._id)] });
    expect(res.status).toBe(201);

    expect(await recipientIdsOf('task_assigned')).toEqual([String(scenario.memberOther._id)]);
  });

  it('updating notifies only people newly added to assignedTo', async () => {
    const scenario = await deliverableScenario();
    // memberAssigned is already on the task; memberOther is added now.
    const res = await api()
      .patch(`/api/tasks/${scenario.task._id}`)
      .set(bearer(scenario.owner))
      .send({ assignedTo: [String(scenario.memberAssigned._id), String(scenario.memberOther._id)] });
    expect(res.status).toBe(200);

    expect(await recipientIdsOf('task_assigned')).toEqual([String(scenario.memberOther._id)]);
  });

  it('re-sending the same assignees, or editing other fields, notifies nobody', async () => {
    const scenario = await deliverableScenario();
    await api()
      .patch(`/api/tasks/${scenario.task._id}`)
      .set(bearer(scenario.owner))
      .send({ assignedTo: [String(scenario.memberAssigned._id)] });
    await api().patch(`/api/tasks/${scenario.task._id}`).set(bearer(scenario.owner)).send({ title: 'Renamed' });

    expect(await Notification.countDocuments({ type: 'task_assigned' })).toBe(0);
  });

  it('an assignee ID from another organization never gets a notification', async () => {
    const scenario = await deliverableScenario();
    const outsiderTenant = await makeTenant();

    await api()
      .patch(`/api/tasks/${scenario.task._id}`)
      .set(bearer(scenario.owner))
      .send({ assignedTo: [String(outsiderTenant.owner._id)] });

    expect(await Notification.countDocuments({ userId: outsiderTenant.owner._id })).toBe(0);
  });
});

describe('notifications: reading them', () => {
  async function seedFor(userId: unknown, organizationId: unknown, count: number, extra: Record<string, unknown> = {}) {
    const documents = Array.from({ length: count }, (_, index) => ({
      organizationId,
      userId,
      type: 'task_assigned',
      message: `Notification ${index + 1}`,
      createdAt: new Date(Date.now() + index * 1000),
      ...extra,
    }));
    return Notification.insertMany(documents);
  }

  it('lists only the caller notifications, newest first, with pagination', async () => {
    const tenant = await makeTenant();
    const member = await makeUser(tenant.org._id, 'member');
    const other = await makeUser(tenant.org._id, 'member');
    await seedFor(member._id, tenant.org._id, 3);
    await seedFor(other._id, tenant.org._id, 2);

    const res = await api().get('/api/notifications?limit=2').set(bearer(member));

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.map((n: { message: string }) => n.message)).toEqual([
      'Notification 3',
      'Notification 2',
    ]);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('unread=true filters, and unread-count counts only the caller unread ones', async () => {
    const tenant = await makeTenant();
    const member = await makeUser(tenant.org._id, 'member');
    const other = await makeUser(tenant.org._id, 'member');
    await seedFor(member._id, tenant.org._id, 2);
    await seedFor(member._id, tenant.org._id, 1, { readAt: new Date() });
    // Another user's unread notifications must not be counted or listed.
    await seedFor(other._id, tenant.org._id, 4);

    const listed = await api().get('/api/notifications?unread=true').set(bearer(member));
    expect(listed.body.data.notifications).toHaveLength(2);

    const counted = await api().get('/api/notifications/unread-count').set(bearer(member));
    expect(counted.status).toBe(200);
    expect(counted.body.data).toEqual({ count: 2 });
  });

  it('marks one notification read, and refuses someone else notification with 404', async () => {
    const tenant = await makeTenant();
    const member = await makeUser(tenant.org._id, 'member');
    const other = await makeUser(tenant.org._id, 'member');
    const [mine] = await seedFor(member._id, tenant.org._id, 1);
    const [theirs] = await seedFor(other._id, tenant.org._id, 1);

    const ok = await api().patch(`/api/notifications/${mine._id}/read`).set(bearer(member));
    expect(ok.status).toBe(200);
    expect((await Notification.findById(mine._id))?.readAt).toBeInstanceOf(Date);

    const denied = await api().patch(`/api/notifications/${theirs._id}/read`).set(bearer(member));
    expect(denied.status).toBe(404);
    expect((await Notification.findById(theirs._id))?.readAt).toBeUndefined();
  });

  it('a malformed notification ID is a 400, not a 500', async () => {
    const tenant = await makeTenant();
    const res = await api().patch('/api/notifications/not-an-id/read').set(bearer(tenant.owner));
    expect(res.status).toBe(400);
  });

  it('read-all marks only the caller unread notifications', async () => {
    const tenant = await makeTenant();
    const member = await makeUser(tenant.org._id, 'member');
    const other = await makeUser(tenant.org._id, 'member');
    await seedFor(member._id, tenant.org._id, 3);
    await seedFor(other._id, tenant.org._id, 2);

    const res = await api().patch('/api/notifications/read-all').set(bearer(member));

    expect(res.status).toBe(200);
    expect(await Notification.countDocuments({ userId: member._id, readAt: { $exists: false } })).toBe(0);
    expect(await Notification.countDocuments({ userId: other._id, readAt: { $exists: false } })).toBe(2);
  });

  it('requires a token', async () => {
    const res = await api().get('/api/notifications');
    expect(res.status).toBe(401);
  });
});

describe('notifications: live push on the private user room', () => {
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

  it('a connected user receives notification:new for their own notification only', async () => {
    const scenario = await deliverableScenario();
    const ownerSocket = await open(tokenFor(scenario.owner));
    const unrelatedSocket = await open(tokenFor(scenario.memberOther));
    const ownerReceived: Array<{ type: string }> = [];
    let unrelatedReceived = 0;
    ownerSocket.on('notification:new', (payload) => ownerReceived.push(payload));
    unrelatedSocket.on('notification:new', () => (unrelatedReceived += 1));
    await wait(300);

    await api().post(`/api/client/tasks/${scenario.task._id}/approve`).set(bearer(scenario.client));
    await wait(400);
    ownerSocket.close();
    unrelatedSocket.close();

    expect(ownerReceived).toHaveLength(1);
    expect(ownerReceived[0]).toMatchObject({ type: 'deliverable_approved' });
    expect(unrelatedReceived).toBe(0);
  });

  it('a client cannot join another user room by emitting a room name', async () => {
    const scenario = await deliverableScenario();
    const nosySocket = await open(tokenFor(scenario.memberOther));
    let received = 0;
    nosySocket.on('notification:new', () => (received += 1));
    // There is no join event for user rooms, so this must do nothing.
    nosySocket.emit('joinUser', String(scenario.owner._id));
    nosySocket.emit('joinProject', `user:${scenario.owner._id}`);
    await wait(300);

    await api().post(`/api/client/tasks/${scenario.task._id}/approve`).set(bearer(scenario.client));
    await wait(400);
    nosySocket.close();

    expect(received).toBe(0);
  });
});
