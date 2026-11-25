import mongoose from 'mongoose';
import { describe, it, expect } from 'vitest';
import { api, bearer, makeTenant, makeProject, makeUser } from './helpers.js';
import Task from '../models/Task.js';
import Comment from '../models/Comment.js';
import User from '../models/User.js';

// CONCEPT: characterization-testing. Updating and deleting a task already
// worked but had no automated tests. These tests describe the behaviour as
// it is, and each rule was then broken on purpose to prove a test notices.

async function scenario() {
  const tenant = await makeTenant();
  const project = await makeProject(tenant.org._id);
  const otherProject = await makeProject(tenant.org._id, 'Other project');
  const admin = await makeUser(tenant.org._id, 'admin');
  const plainMember = await makeUser(tenant.org._id, 'member');
  // A member who is manager of THIS project only.
  const projectManager = await makeUser(tenant.org._id, 'member');
  await User.updateOne({ _id: projectManager._id }, { $push: { projectRoles: { projectId: project._id, role: 'manager' } } });
  // A member who is manager of ANOTHER project only.
  const managerElsewhere = await makeUser(tenant.org._id, 'member');
  await User.updateOne({ _id: managerElsewhere._id }, { $push: { projectRoles: { projectId: otherProject._id, role: 'manager' } } });
  const client = await makeUser(tenant.org._id, 'client');
  const outsider = await makeTenant();
  const task = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Original title',
    description: 'Original description',
    status: 'todo',
    assignedTo: [plainMember._id],
  });
  return { ...tenant, project, otherProject, admin, plainMember, projectManager, managerElsewhere, client, outsider, task };
}

describe('updating a task: who may do it', () => {
  it('owner, admin and the manager of that project can update', async () => {
    const { owner, admin, projectManager, task } = await scenario();
    for (const [actor, title] of [
      [owner, 'By owner'],
      [admin, 'By admin'],
      [projectManager, 'By project manager'],
    ] as const) {
      const res = await api().patch(`/api/tasks/${task._id}`).set(bearer(actor)).send({ title });
      expect(res.status).toBe(200);
      expect(res.body.data.task.title).toBe(title);
      expect((await Task.findById(task._id))?.title).toBe(title);
    }
  });

  it('a member without a role on the project, a manager of another project and a client are refused', async () => {
    const { plainMember, managerElsewhere, client, task } = await scenario();
    for (const actor of [plainMember, managerElsewhere, client]) {
      const res = await api().patch(`/api/tasks/${task._id}`).set(bearer(actor)).send({ title: 'Hijacked' });
      expect(res.status).toBe(403);
    }
    expect((await Task.findById(task._id))?.title).toBe('Original title');
  });

  it('without a token the answer is 401', async () => {
    const { task } = await scenario();
    const res = await api().patch(`/api/tasks/${task._id}`).send({ title: 'Anonymous' });
    expect(res.status).toBe(401);
    expect((await Task.findById(task._id))?.title).toBe('Original title');
  });

  it('a task of another organization is a 404 and stays unchanged', async () => {
    const { outsider, task } = await scenario();
    const res = await api().patch(`/api/tasks/${task._id}`).set(bearer(outsider.owner)).send({ title: 'Cross-tenant' });
    expect(res.status).toBe(404);
    expect((await Task.findById(task._id))?.title).toBe('Original title');
  });

  it('a task that does not exist is a 404 and a malformed id is a 400', async () => {
    const { owner } = await scenario();
    const missing = await api().patch(`/api/tasks/${new mongoose.Types.ObjectId()}`).set(bearer(owner)).send({ title: 'x' });
    expect(missing.status).toBe(404);
    const malformed = await api().patch('/api/tasks/not-an-id').set(bearer(owner)).send({ title: 'x' });
    expect(malformed.status).toBe(400);
  });
});

describe('updating a task: what changes', () => {
  it('changes only the fields sent, and trims the title', async () => {
    const { owner, task } = await scenario();
    const res = await api()
      .patch(`/api/tasks/${task._id}`)
      .set(bearer(owner))
      .send({ title: '  Padded title  ', status: 'in_progress', dueDate: '2030-05-01T00:00:00.000Z' });
    expect(res.status).toBe(200);

    const saved = await Task.findById(task._id);
    expect(saved?.title).toBe('Padded title');
    expect(saved?.status).toBe('in_progress');
    expect(saved?.dueDate?.toISOString()).toBe('2030-05-01T00:00:00.000Z');
    // not sent, so not touched
    expect(saved?.description).toBe('Original description');
    expect(saved?.assignedTo).toHaveLength(1);
  });

  it('the description can be changed on its own', async () => {
    const { owner, task } = await scenario();
    const res = await api().patch(`/api/tasks/${task._id}`).set(bearer(owner)).send({ description: 'New description' });
    expect(res.status).toBe(200);
    const saved = await Task.findById(task._id);
    expect(saved?.description).toBe('New description');
    expect(saved?.title).toBe('Original title');
  });

  it.each([
    ['an empty title', { title: '' }],
    ['a title of only spaces', { title: '   ' }],
    ['a title over 200 characters', { title: 'x'.repeat(201) }],
    ['an unknown status', { status: 'finished' }],
    ['a description over 2000 characters', { description: 'x'.repeat(2001) }],
    ['a date that is not a date', { dueDate: 'next tuesday-ish' }],
    ['an assignee id that is not an id', { assignedTo: ['abc'] }],
  ])('%s is a 400 and changes nothing', async (_label, body) => {
    const { owner, task } = await scenario();
    const res = await api().patch(`/api/tasks/${task._id}`).set(bearer(owner)).send(body);
    expect(res.status).toBe(400);
    const saved = await Task.findById(task._id);
    expect(saved?.title).toBe('Original title');
    expect(saved?.status).toBe('todo');
    expect(saved?.description).toBe('Original description');
  });

  it('fields that are not settable here are ignored: approval state, deliverable flag, owner organization and project', async () => {
    const { owner, task, outsider, otherProject } = await scenario();
    const res = await api()
      .patch(`/api/tasks/${task._id}`)
      .set(bearer(owner))
      .send({
        title: 'Renamed',
        approvalStatus: 'approved',
        clientFeedback: 'Looks great',
        isDeliverable: true,
        organizationId: String(outsider.org._id),
        projectId: String(otherProject._id),
      });
    expect(res.status).toBe(200);

    const saved = await Task.findById(task._id);
    expect(saved?.title).toBe('Renamed');
    expect(saved?.approvalStatus).toBeUndefined();
    expect(saved?.clientFeedback).toBeUndefined();
    expect(saved?.isDeliverable).toBe(false);
    expect(String(saved?.organizationId)).toBe(String(task.organizationId));
    expect(String(saved?.projectId)).toBe(String(task.projectId));
  });

  it('an update with an empty body changes nothing and answers with the task', async () => {
    const { owner, task } = await scenario();
    const res = await api().patch(`/api/tasks/${task._id}`).set(bearer(owner)).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.task.title).toBe('Original title');
    expect((await Task.findById(task._id))?.title).toBe('Original title');
  });
});

describe('deleting a task', () => {
  it('owner and admin can delete it', async () => {
    const { owner, admin, project } = await scenario();
    for (const actor of [owner, admin]) {
      const task = await Task.create({ organizationId: project.organizationId, projectId: project._id, title: 'Doomed' });
      const res = await api().delete(`/api/tasks/${task._id}`).set(bearer(actor));
      expect(res.status).toBe(204);
      expect(await Task.findById(task._id)).toBeNull();
    }
  });

  it('a project manager, a plain member, a manager of another project and a client are refused', async () => {
    const { projectManager, plainMember, managerElsewhere, client, task } = await scenario();
    for (const actor of [projectManager, plainMember, managerElsewhere, client]) {
      const res = await api().delete(`/api/tasks/${task._id}`).set(bearer(actor));
      expect(res.status).toBe(403);
    }
    expect(await Task.findById(task._id)).not.toBeNull();
  });

  it('without a token the answer is 401', async () => {
    const { task } = await scenario();
    const res = await api().delete(`/api/tasks/${task._id}`);
    expect(res.status).toBe(401);
    expect(await Task.findById(task._id)).not.toBeNull();
  });

  it('a task of another organization is a 404 and is not deleted', async () => {
    const { outsider, task } = await scenario();
    const res = await api().delete(`/api/tasks/${task._id}`).set(bearer(outsider.owner));
    expect(res.status).toBe(404);
    expect(await Task.findById(task._id)).not.toBeNull();
  });

  it('a missing task is a 404, a malformed id is a 400, and deleting twice gives 404 the second time', async () => {
    const { owner, task } = await scenario();
    expect((await api().delete(`/api/tasks/${new mongoose.Types.ObjectId()}`).set(bearer(owner))).status).toBe(404);
    expect((await api().delete('/api/tasks/not-an-id').set(bearer(owner))).status).toBe(400);
    expect((await api().delete(`/api/tasks/${task._id}`).set(bearer(owner))).status).toBe(204);
    expect((await api().delete(`/api/tasks/${task._id}`).set(bearer(owner))).status).toBe(404);
  });

  it("deleting a task deletes its comments and no other task's comments", async () => {
    const { owner, org, project, task, outsider } = await scenario();
    const otherTask = await Task.create({ organizationId: org._id, projectId: project._id, title: 'Other task' });
    const makeComment = (taskId: unknown, organizationId: unknown, body: string) =>
      Comment.create({ organizationId, projectId: project._id, taskId, authorId: owner._id, authorRole: 'staff', body, visibility: 'shared' });
    await makeComment(task._id, org._id, 'on the doomed task 1');
    await makeComment(task._id, org._id, 'on the doomed task 2');
    await makeComment(otherTask._id, org._id, 'on the other task');
    // a comment of another organization that happens to point at the same task id
    await makeComment(task._id, outsider.org._id, 'foreign comment');

    expect((await api().delete(`/api/tasks/${task._id}`).set(bearer(owner))).status).toBe(204);

    expect(await Comment.countDocuments({ organizationId: org._id, taskId: task._id })).toBe(0);
    expect(await Comment.countDocuments({ organizationId: org._id, taskId: otherTask._id })).toBe(1);
    expect(await Comment.countDocuments({ organizationId: outsider.org._id })).toBe(1);
  });
});
