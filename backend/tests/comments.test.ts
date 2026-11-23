import http from 'http';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import mongoose from 'mongoose';
import { api, bearer, tokenFor, makeTenant, makeProject, makeUser } from './helpers.js';
import { initializeSocket } from '../lib/socket.js';
import ClientAccess from '../models/ClientAccess.js';
import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import Task from '../models/Task.js';

// CONCEPT: comments (core, staff). Written BEFORE the implementation: every
// test here fails until the Comment model, service, routes, cascade and
// staff socket room exist.

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

// An organization with an owner, an admin, two members, a project and a task
// assigned to member A.
async function scenario() {
  const tenant = await makeTenant();
  const admin = await makeUser(tenant.org._id, 'admin');
  const memberA = await makeUser(tenant.org._id, 'member');
  const memberB = await makeUser(tenant.org._id, 'member');
  const project = await makeProject(tenant.org._id);
  const task = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Homepage design',
    assignedTo: [memberA._id],
  });
  return { ...tenant, admin, memberA, memberB, project, task };
}

const postComment = (task: { _id: unknown }, user: Parameters<typeof bearer>[0], body: unknown) =>
  api().post(`/api/tasks/${task._id}/comments`).set(bearer(user)).send(body as object);

describe('comments: creating and listing', () => {
  it('creates a comment and lists the thread oldest first, paginated', async () => {
    const { task, memberA, memberB } = await scenario();
    expect((await postComment(task, memberA, { body: 'First' })).status).toBe(201);
    await wait(15);
    await postComment(task, memberB, { body: 'Second' });
    await wait(15);
    await postComment(task, memberA, { body: 'Third' });

    const res = await api().get(`/api/tasks/${task._id}/comments?limit=2`).set(bearer(memberA));

    expect(res.status).toBe(200);
    expect(res.body.data.comments.map((comment: { body: string }) => comment.body)).toEqual(['First', 'Second']);
    expect(res.body.pagination).toMatchObject({ page: 1, limit: 2, total: 3, totalPages: 2 });
  });

  it('takes author, organization and project from the token and the task, never the body', async () => {
    const { task, memberA, memberB, orgId, project } = await scenario();
    const outsider = await makeTenant();

    const res = await postComment(task, memberA, {
      body: 'Forged fields',
      authorId: String(memberB._id),
      organizationId: String(outsider.org._id),
      projectId: String(new mongoose.Types.ObjectId()),
    });

    expect(res.status).toBe(201);
    const stored = await Comment.findById(res.body.data.comment._id);
    expect(String(stored?.authorId)).toBe(String(memberA._id));
    expect(String(stored?.organizationId)).toBe(orgId);
    expect(String(stored?.projectId)).toBe(String(project._id));
    expect(String(stored?.taskId)).toBe(String(task._id));
    expect(stored?.authorRole).toBe('staff');
  });

  it('trims the text and rejects empty, blank and over-long bodies', async () => {
    const { task, memberA } = await scenario();

    const trimmed = await postComment(task, memberA, { body: '  hello  ' });
    expect(trimmed.status).toBe(201);
    expect(trimmed.body.data.comment.body).toBe('hello');

    expect((await postComment(task, memberA, { body: '' })).status).toBe(400);
    expect((await postComment(task, memberA, { body: '   ' })).status).toBe(400);
    expect((await postComment(task, memberA, { body: 'x'.repeat(2001) })).status).toBe(400);
    expect((await postComment(task, memberA, { body: 'x'.repeat(2000) })).status).toBe(201);
    expect(await Comment.countDocuments()).toBe(2);
  });

  it('a task of another organization, a missing task and a malformed id write nothing', async () => {
    const { task, memberA } = await scenario();
    const outsider = await makeTenant();

    expect((await postComment(task, outsider.owner, { body: 'Intruder' })).status).toBe(404);
    expect((await postComment({ _id: new mongoose.Types.ObjectId() }, memberA, { body: 'Ghost' })).status).toBe(404);
    expect((await postComment({ _id: 'not-an-id' }, memberA, { body: 'Bad id' })).status).toBe(400);
    expect(await Comment.countDocuments()).toBe(0);

    const listed = await api().get(`/api/tasks/${task._id}/comments`).set(bearer(outsider.owner));
    expect(listed.status).toBe(404);
  });

  it('requires a token', async () => {
    const { task } = await scenario();
    const res = await api().get(`/api/tasks/${task._id}/comments`);
    expect(res.status).toBe(401);
  });
});

describe('comments: editing', () => {
  it('the author can edit, which sets editedAt', async () => {
    const { task, memberA } = await scenario();
    const created = await postComment(task, memberA, { body: 'Original' });
    const commentId = created.body.data.comment._id;

    const res = await api().patch(`/api/comments/${commentId}`).set(bearer(memberA)).send({ body: 'Changed' });

    expect(res.status).toBe(200);
    expect(res.body.data.comment.body).toBe('Changed');
    expect((await Comment.findById(commentId))?.editedAt).toBeInstanceOf(Date);
  });

  it('another member and even an admin cannot edit it: 404 and nothing changes', async () => {
    const { task, memberA, memberB, admin } = await scenario();
    const created = await postComment(task, memberA, { body: 'Mine' });
    const commentId = created.body.data.comment._id;

    for (const other of [memberB, admin]) {
      const res = await api().patch(`/api/comments/${commentId}`).set(bearer(other)).send({ body: 'Hijacked' });
      expect(res.status).toBe(404);
    }
    const stored = await Comment.findById(commentId);
    expect(stored?.body).toBe('Mine');
    expect(stored?.editedAt).toBeUndefined();
  });

  it('an edit applies the same body rules', async () => {
    const { task, memberA } = await scenario();
    const created = await postComment(task, memberA, { body: 'Fine' });
    const res = await api()
      .patch(`/api/comments/${created.body.data.comment._id}`)
      .set(bearer(memberA))
      .send({ body: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('comments: deleting', () => {
  it('the author can delete their own comment', async () => {
    const { task, memberA } = await scenario();
    const created = await postComment(task, memberA, { body: 'Oops' });
    const res = await api().delete(`/api/comments/${created.body.data.comment._id}`).set(bearer(memberA));
    expect(res.status).toBe(204);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('an admin and the owner of the same organization can delete anyone comment', async () => {
    const { task, memberA, admin, owner } = await scenario();
    const first = await postComment(task, memberA, { body: 'One' });
    const second = await postComment(task, memberA, { body: 'Two' });

    expect((await api().delete(`/api/comments/${first.body.data.comment._id}`).set(bearer(admin))).status).toBe(204);
    expect((await api().delete(`/api/comments/${second.body.data.comment._id}`).set(bearer(owner))).status).toBe(204);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('another member cannot delete it, and neither can anyone from another organization', async () => {
    const { task, memberA, memberB } = await scenario();
    const outsider = await makeTenant();
    const created = await postComment(task, memberA, { body: 'Keep me' });
    const commentId = created.body.data.comment._id;

    expect((await api().delete(`/api/comments/${commentId}`).set(bearer(memberB))).status).toBe(404);
    expect((await api().delete(`/api/comments/${commentId}`).set(bearer(outsider.owner))).status).toBe(404);
    expect(await Comment.countDocuments()).toBe(1);
  });

  it('a malformed comment id is a 400', async () => {
    const { memberA } = await scenario();
    const res = await api().delete('/api/comments/not-an-id').set(bearer(memberA));
    expect(res.status).toBe(400);
  });
});

describe('comments: cascade delete', () => {
  it('deleting a task deletes its comments and no others', async () => {
    const { task, owner, memberA, project, orgId } = await scenario();
    const otherTask = await Task.create({ organizationId: orgId, projectId: project._id, title: 'Other' });
    await postComment(task, memberA, { body: 'On the deleted task' });
    await postComment(otherTask, memberA, { body: 'On the other task' });

    const res = await api().delete(`/api/tasks/${task._id}`).set(bearer(owner));

    expect(res.status).toBe(204);
    expect(await Comment.countDocuments({ taskId: task._id })).toBe(0);
    expect(await Comment.countDocuments({ taskId: otherTask._id })).toBe(1);
  });

  it('deleting a project deletes the comments of its tasks and no others', async () => {
    const { task, owner, memberA, orgId } = await scenario();
    const otherProject = await makeProject(orgId, 'Other project');
    const otherTask = await Task.create({ organizationId: orgId, projectId: otherProject._id, title: 'Elsewhere' });
    await postComment(task, memberA, { body: 'Doomed' });
    await postComment(otherTask, memberA, { body: 'Survivor' });

    const res = await api().delete(`/api/projects/${task.projectId}`).set(bearer(owner));

    expect(res.status).toBe(204);
    expect(await Comment.countDocuments({ taskId: task._id })).toBe(0);
    expect(await Comment.countDocuments({ taskId: otherTask._id })).toBe(1);
  });
});

describe('comments: notifications', () => {
  it('notifies the assignee and earlier commenters once each, never the author', async () => {
    const { task, memberA, memberB, admin } = await scenario();
    // memberB comments first, so memberB is an earlier commenter later on.
    await postComment(task, memberB, { body: 'Early thought' });
    await Notification.deleteMany({});

    // The admin comments: memberA (assignee) and memberB (earlier) are told, the admin is not.
    await postComment(task, admin, { body: 'Looks good' });

    const recipients = (await Notification.find({ type: 'comment_added' })).map((n) => String(n.userId)).sort();
    expect(recipients).toEqual([String(memberA._id), String(memberB._id)].sort());
    const stored = await Notification.findOne({ userId: memberA._id });
    expect(stored?.message).toContain('Homepage design');
    expect(stored?.message).not.toContain('Looks good'); // generic text, never the body
  });

  it('notifies nobody when the only candidates are the author', async () => {
    const { task, memberA } = await scenario();
    await postComment(task, memberA, { body: 'Talking to myself' });
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('a failure while saving notifications does not fail the comment', async () => {
    const { task, admin } = await scenario();
    const spy = vi.spyOn(Notification, 'insertMany').mockRejectedValueOnce(new Error('database down'));

    const res = await postComment(task, admin, { body: 'Still saved' });

    expect(res.status).toBe(201);
    expect(await Comment.countDocuments()).toBe(1);
    spy.mockRestore();
  });
});

describe('comments: live events', () => {
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

  it('staff in the project room receive created, updated and deleted events; others receive nothing', async () => {
    const { task, owner, memberA, project, orgId } = await scenario();
    const outsider = await makeTenant();
    const client = await makeUser(orgId, 'client');
    await ClientAccess.create({
      userId: client._id,
      organizationId: orgId,
      projectId: project._id,
      permissions: ['view', 'approve'],
    });

    const staffSocket = await open(tokenFor(owner));
    const clientSocket = await open(tokenFor(client));
    const outsiderSocket = await open(tokenFor(outsider.owner));
    const staffEvents: string[] = [];
    let clientEvents = 0;
    let outsiderEvents = 0;
    for (const eventName of ['comment:created', 'comment:updated', 'comment:deleted']) {
      staffSocket.on(eventName, () => staffEvents.push(eventName));
      clientSocket.on(eventName, () => (clientEvents += 1));
      outsiderSocket.on(eventName, () => (outsiderEvents += 1));
    }
    for (const socket of [staffSocket, clientSocket, outsiderSocket]) {
      socket.emit('joinProject', String(project._id));
    }
    await wait(400);

    const created = await postComment(task, memberA, { body: 'Live one' });
    const commentId = created.body.data.comment._id;
    await api().patch(`/api/comments/${commentId}`).set(bearer(memberA)).send({ body: 'Live two' });
    await api().delete(`/api/comments/${commentId}`).set(bearer(memberA));
    await wait(500);
    [staffSocket, clientSocket, outsiderSocket].forEach((socket) => socket.close());

    expect(staffEvents).toEqual(['comment:created', 'comment:updated', 'comment:deleted']);
    // Step 1 sends comments to the staff room only; clients get access in the visibility step.
    expect(clientEvents).toBe(0);
    expect(outsiderEvents).toBe(0);
  });
});
