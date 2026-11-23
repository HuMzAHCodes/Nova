import mongoose from 'mongoose';
import { describe, it, expect } from 'vitest';
import { api, bearer, makeTenant, makeProject, makeUser } from './helpers.js';
import Task from '../models/Task.js';

// CONCEPT: assignee-validation (KL-15). A task may only be assigned to
// staff of the SAME organization. Written before the fix: the first
// tests fail until the assignee check exists.

async function scenario() {
  const tenant = await makeTenant();
  const project = await makeProject(tenant.org._id);
  const member = await makeUser(tenant.org._id, 'member');
  const admin = await makeUser(tenant.org._id, 'admin');
  const client = await makeUser(tenant.org._id, 'client');
  const outsiderTenant = await makeTenant();
  const task = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Existing task',
    assignedTo: [member._id],
  });
  return { ...tenant, project, member, admin, client, outsider: outsiderTenant.owner, task };
}

describe('KL-15: assignees must belong to the organization', () => {
  it('creating a task with a user of another organization is a 400 and writes nothing', async () => {
    const { owner, project, outsider } = await scenario();
    const tasksBefore = await Task.countDocuments();

    const res = await api()
      .post(`/api/projects/${project._id}/tasks`)
      .set(bearer(owner))
      .send({ title: 'Sneaky', assignedTo: [String(outsider._id)] });

    expect(res.status).toBe(400);
    expect(await Task.countDocuments()).toBe(tasksBefore);
  });

  it('creating a task with an ID that is no user at all is a 400', async () => {
    const { owner, project } = await scenario();
    const res = await api()
      .post(`/api/projects/${project._id}/tasks`)
      .set(bearer(owner))
      .send({ title: 'Ghost', assignedTo: [String(new mongoose.Types.ObjectId())] });
    expect(res.status).toBe(400);
  });

  it('a client cannot be an assignee, even of the same organization', async () => {
    const { owner, project, client } = await scenario();
    const res = await api()
      .post(`/api/projects/${project._id}/tasks`)
      .set(bearer(owner))
      .send({ title: 'For a client', assignedTo: [String(client._id)] });
    expect(res.status).toBe(400);
  });

  it('one bad ID among good ones rejects the whole request', async () => {
    const { owner, project, member, outsider } = await scenario();
    const res = await api()
      .post(`/api/projects/${project._id}/tasks`)
      .set(bearer(owner))
      .send({ title: 'Mixed', assignedTo: [String(member._id), String(outsider._id)] });
    expect(res.status).toBe(400);
  });

  it('owners, admins and members of the organization are accepted, duplicates included', async () => {
    const { owner, project, member, admin } = await scenario();
    const res = await api()
      .post(`/api/projects/${project._id}/tasks`)
      .set(bearer(owner))
      .send({
        title: 'Team task',
        assignedTo: [String(member._id), String(admin._id), String(owner._id), String(member._id)],
      });
    expect(res.status).toBe(201);
  });

  it('updating assignedTo to a user of another organization is a 400 and the task is unchanged', async () => {
    const { owner, task, member, outsider } = await scenario();
    const res = await api()
      .patch(`/api/tasks/${task._id}`)
      .set(bearer(owner))
      .send({ assignedTo: [String(outsider._id)] });

    expect(res.status).toBe(400);
    const fresh = await Task.findById(task._id);
    expect(fresh?.assignedTo.map(String)).toEqual([String(member._id)]);
  });

  it('updating assignedTo to valid staff works', async () => {
    const { owner, task, admin } = await scenario();
    const res = await api()
      .patch(`/api/tasks/${task._id}`)
      .set(bearer(owner))
      .send({ assignedTo: [String(admin._id)] });
    expect(res.status).toBe(200);
    expect((await Task.findById(task._id))?.assignedTo.map(String)).toEqual([String(admin._id)]);
  });

  it('an update that does not touch assignedTo is not blocked by it', async () => {
    const { owner, task } = await scenario();
    const res = await api().patch(`/api/tasks/${task._id}`).set(bearer(owner)).send({ title: 'Renamed' });
    expect(res.status).toBe(200);
  });
});
