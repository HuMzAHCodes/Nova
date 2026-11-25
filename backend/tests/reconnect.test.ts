import { describe, it, expect } from 'vitest';
import { api, bearer, makeTenant, makeProject, makeUser } from './helpers.js';
import ClientAccess from '../models/ClientAccess.js';
import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import Task from '../models/Task.js';

// CONCEPT: reconnect-handling. Written BEFORE the implementation. The server
// does not replay missed socket events. After a reconnect the client asks
// the existing list endpoints "what is new since T?" using ?since=<ISO time>.
// Comments: created or edited after T. Notifications: created after T.
// Every other rule (visibility, tenant scoping, pagination) still applies.

const minutes = (count: number) => new Date(Date.UTC(2026, 0, 1, 12, count, 0));
const isoMinutes = (count: number) => minutes(count).toISOString();

async function scenario() {
  const tenant = await makeTenant();
  const admin = await makeUser(tenant.org._id, 'admin');
  const project = await makeProject(tenant.org._id);
  const deliverable = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Logo deliverable',
    isDeliverable: true,
    approvalStatus: 'pending',
  });
  const client = await makeUser(tenant.org._id, 'client');
  await ClientAccess.create({
    userId: client._id,
    organizationId: tenant.org._id,
    projectId: project._id,
    permissions: ['view'],
  });
  const outsider = await makeTenant();
  return { ...tenant, admin, project, deliverable, client, outsider };
}

// Stores a comment with an exact creation time (and optional edit time) so
// the tests do not depend on the clock.
async function storeComment(
  context: { org: { _id: unknown }; project: { _id: unknown }; deliverable: { _id: unknown }; admin: { _id: unknown } },
  body: string,
  createdAtMinute: number,
  options: { visibility?: 'internal' | 'shared'; editedAtMinute?: number } = {}
) {
  return Comment.create({
    organizationId: context.org._id,
    projectId: context.project._id,
    taskId: context.deliverable._id,
    authorId: context.admin._id,
    authorRole: 'staff',
    body,
    visibility: options.visibility ?? 'internal',
    createdAt: minutes(createdAtMinute),
    ...(options.editedAtMinute !== undefined ? { editedAt: minutes(options.editedAtMinute) } : {}),
  });
}

const staffList = (taskId: unknown, user: Parameters<typeof bearer>[0], query: string) =>
  api().get(`/api/tasks/${taskId}/comments${query}`).set(bearer(user));
const clientList = (taskId: unknown, user: Parameters<typeof bearer>[0], query: string) =>
  api().get(`/api/client/tasks/${taskId}/comments${query}`).set(bearer(user));

describe('reconnect: comments since a time', () => {
  it('returns only comments created after the time, oldest first, with a matching total', async () => {
    const context = await scenario();
    await storeComment(context, 'before', 1);
    await storeComment(context, 'after one', 5);
    await storeComment(context, 'after two', 6);

    const res = await staffList(context.deliverable._id, context.admin, `?since=${isoMinutes(3)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['after one', 'after two']);
    expect(res.body.pagination.total).toBe(2);
  });

  it('the time itself is excluded (strictly after)', async () => {
    const context = await scenario();
    await storeComment(context, 'exactly then', 3);

    const res = await staffList(context.deliverable._id, context.admin, `?since=${isoMinutes(3)}`);

    expect(res.body.data.comments).toEqual([]);
  });

  it('also returns an older comment that was edited after the time', async () => {
    const context = await scenario();
    await storeComment(context, 'old and untouched', 1);
    await storeComment(context, 'old but edited', 2, { editedAtMinute: 8 });

    const res = await staffList(context.deliverable._id, context.admin, `?since=${isoMinutes(5)}`);

    expect(res.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['old but edited']);
  });

  it('works together with pagination', async () => {
    const context = await scenario();
    await storeComment(context, 'a', 5);
    await storeComment(context, 'b', 6);
    await storeComment(context, 'c', 7);

    const first = await staffList(context.deliverable._id, context.admin, `?since=${isoMinutes(3)}&limit=2&page=1`);
    const second = await staffList(context.deliverable._id, context.admin, `?since=${isoMinutes(3)}&limit=2&page=2`);

    expect(first.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['a', 'b']);
    expect(second.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['c']);
    expect(first.body.pagination.total).toBe(3);
  });

  it('without since the whole thread is returned, as before', async () => {
    const context = await scenario();
    await storeComment(context, 'one', 1);
    await storeComment(context, 'two', 2);

    const res = await staffList(context.deliverable._id, context.admin, '');

    expect(res.body.data.comments).toHaveLength(2);
  });

  it('rejects a since value that is not a date', async () => {
    const context = await scenario();

    for (const bad of ['?since=yesterday', '?since=', '?since=a&since=b']) {
      const res = await staffList(context.deliverable._id, context.admin, bad);
      expect(res.status, bad).toBe(400);
    }
  });

  it('a client with since never receives internal comments, even edited ones', async () => {
    const context = await scenario();
    await storeComment(context, 'internal new', 5, { visibility: 'internal' });
    await storeComment(context, 'internal edited', 1, { visibility: 'internal', editedAtMinute: 8 });
    await storeComment(context, 'shared new', 6, { visibility: 'shared' });

    const res = await clientList(context.deliverable._id, context.client, `?since=${isoMinutes(3)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['shared new']);
    expect(res.body.pagination.total).toBe(1);
  });

  it('since does not open another organization or a task without access', async () => {
    const context = await scenario();
    await storeComment(context, 'private', 5);

    const otherOrganization = await staffList(context.deliverable._id, context.outsider.owner, `?since=${isoMinutes(3)}`);
    const clientWithoutGrant = await makeUser(context.org._id, 'client');
    const noGrant = await clientList(context.deliverable._id, clientWithoutGrant, `?since=${isoMinutes(3)}`);

    expect(otherOrganization.status).toBe(404);
    expect(noGrant.status).toBe(404);
  });
});

describe('reconnect: notifications since a time', () => {
  async function storeNotification(
    context: { org: { _id: unknown }; admin: { _id: unknown } },
    message: string,
    createdAtMinute: number,
    options: { read?: boolean; userId?: unknown } = {}
  ) {
    return Notification.create({
      organizationId: context.org._id,
      userId: options.userId ?? context.admin._id,
      type: 'task_assigned',
      message,
      createdAt: minutes(createdAtMinute),
      ...(options.read ? { readAt: minutes(createdAtMinute + 1) } : {}),
    });
  }

  const list = (user: Parameters<typeof bearer>[0], query: string) =>
    api().get(`/api/notifications${query}`).set(bearer(user));

  it('returns only notifications created after the time, newest first', async () => {
    const context = await scenario();
    await storeNotification(context, 'before', 1);
    await storeNotification(context, 'after one', 5);
    await storeNotification(context, 'after two', 6);

    const res = await list(context.admin, `?since=${isoMinutes(3)}`);

    expect(res.status).toBe(200);
    expect(res.body.data.notifications.map((item: { message: string }) => item.message)).toEqual(['after two', 'after one']);
    expect(res.body.pagination.total).toBe(2);
  });

  it('the time itself is excluded (strictly after)', async () => {
    const context = await scenario();
    await storeNotification(context, 'exactly then', 3);

    const res = await list(context.admin, `?since=${isoMinutes(3)}`);

    expect(res.body.data.notifications).toEqual([]);
  });

  it('combines with unread=true', async () => {
    const context = await scenario();
    await storeNotification(context, 'new and read', 5, { read: true });
    await storeNotification(context, 'new and unread', 6);

    const res = await list(context.admin, `?since=${isoMinutes(3)}&unread=true`);

    expect(res.body.data.notifications.map((item: { message: string }) => item.message)).toEqual(['new and unread']);
  });

  it('never includes another user notifications', async () => {
    const context = await scenario();
    await storeNotification(context, 'mine', 5);
    await storeNotification(context, 'someone else', 6, { userId: context.owner._id });

    const res = await list(context.admin, `?since=${isoMinutes(3)}`);

    expect(res.body.data.notifications.map((item: { message: string }) => item.message)).toEqual(['mine']);
  });

  it('without since the list is unchanged', async () => {
    const context = await scenario();
    await storeNotification(context, 'one', 1);
    await storeNotification(context, 'two', 5);

    const res = await list(context.admin, '');

    expect(res.body.data.notifications).toHaveLength(2);
  });

  it('rejects a since value that is not a date', async () => {
    const context = await scenario();

    for (const bad of ['?since=yesterday', '?since=']) {
      const res = await list(context.admin, bad);
      expect(res.status, bad).toBe(400);
    }
  });
});

describe('reconnect: catching up after being offline', () => {
  it('a client that last saw minute 5 fetches only what it missed', async () => {
    const context = await scenario();
    const lastSeen = await storeComment(context, 'last one I saw', 5, { visibility: 'shared' });
    await storeComment(context, 'missed while offline', 9, { visibility: 'shared' });
    await storeComment(context, 'internal, never shown', 10, { visibility: 'internal' });

    // The client uses the createdAt of the newest comment it holds, not its own clock.
    const res = await clientList(context.deliverable._id, context.client, `?since=${lastSeen.createdAt.toISOString()}`);

    expect(res.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['missed while offline']);
  });
});
