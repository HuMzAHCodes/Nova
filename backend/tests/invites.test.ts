import { describe, it, expect } from 'vitest';
import { api, bearer, makeTenant, makeProject, makeUser, mocks } from './helpers.js';
import User from '../models/User.js';
import ClientAccess from '../models/ClientAccess.js';
import Task from '../models/Task.js';

// CONCEPT: response-shaping (KL-2)
describe('KL-2: team invite response exposes only safe fields', () => {
  it('returns id, email, name and role, never hashes or tokens', async () => {
    const { owner, orgId } = await makeTenant();
    const res = await api()
      .post(`/api/organizations/${orgId}/team/invite`)
      .set(bearer(owner))
      .send({ email: 'new@example.com', name: 'New Person', role: 'member' });
    expect(res.status).toBe(201);
    const user = res.body.data.user;
    expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name', 'role']);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|passwordResetTokenHash|passwordResetExpires/);
    expect(mocks.teamInvite()).toHaveBeenCalledTimes(1);
  });

  it('only owners may invite', async () => {
    const { org, orgId } = await makeTenant();
    const admin = await makeUser(org._id, 'admin');
    const res = await api()
      .post(`/api/organizations/${orgId}/team/invite`)
      .set(bearer(admin))
      .send({ email: 'x@example.com', name: 'X', role: 'member' });
    expect(res.status).toBe(403);
  });
});

// CONCEPT: input normalization (KL-9)
describe('KL-9: team invite normalizes the email', () => {
  it('trims and lowercases before storing', async () => {
    const { owner, orgId } = await makeTenant();
    const res = await api()
      .post(`/api/organizations/${orgId}/team/invite`)
      .set(bearer(owner))
      .send({ email: '  Mixed.Case@Example.COM ', name: 'Mixed', role: 'member' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.email).toBe('mixed.case@example.com');
    expect(await User.findOne({ email: 'mixed.case@example.com' })).not.toBeNull();
  });

  it('a duplicate in a different case is a 409, not a 500', async () => {
    const { owner, orgId } = await makeTenant();
    const first = await api()
      .post(`/api/organizations/${orgId}/team/invite`)
      .set(bearer(owner))
      .send({ email: 'dup@example.com', name: 'Dup', role: 'member' });
    expect(first.status).toBe(201);
    const second = await api()
      .post(`/api/organizations/${orgId}/team/invite`)
      .set(bearer(owner))
      .send({ email: 'DUP@Example.com', name: 'Dup', role: 'member' });
    expect(second.status).toBe(409);
  });
});

// CONCEPT: tenant-bound identity (KL-4)
describe('KL-4: a client from another organization cannot be pulled in', () => {
  it('inviting an existing client of org B from org A is a 409 and writes nothing', async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const clientOfB = await makeUser(b.org._id, 'client', 'shared@example.com');
    const projectA = await makeProject(a.org._id);

    const res = await api()
      .post(`/api/projects/${projectA._id}/client-invites`)
      .set(bearer(a.owner))
      .send({ email: 'shared@example.com', name: 'Shared' });

    expect(res.status).toBe(409);
    expect(await ClientAccess.countDocuments({ userId: clientOfB._id })).toBe(0);
    expect(mocks.clientInvite()).not.toHaveBeenCalled();
    const fresh = await User.findById(clientOfB._id).select('+passwordResetTokenHash');
    expect(fresh?.passwordResetTokenHash).toBeUndefined();
  });

  it('inviting a new client creates the user in the inviting org', async () => {
    const a = await makeTenant();
    const projectA = await makeProject(a.org._id);
    const res = await api()
      .post(`/api/projects/${projectA._id}/client-invites`)
      .set(bearer(a.owner))
      .send({ email: 'fresh@example.com', name: 'Fresh' });
    expect(res.status).toBe(201);
    expect(res.body.data.client.email).toBe('fresh@example.com');
    const user = await User.findOne({ email: 'fresh@example.com' });
    expect(String(user?.organizationId)).toBe(a.orgId);
  });

  it('a second project for the same org client works', async () => {
    const a = await makeTenant();
    const p1 = await makeProject(a.org._id, 'One');
    const p2 = await makeProject(a.org._id, 'Two');
    const body = { email: 'again@example.com', name: 'Again' };
    expect((await api().post(`/api/projects/${p1._id}/client-invites`).set(bearer(a.owner)).send(body)).status).toBe(201);
    expect((await api().post(`/api/projects/${p2._id}/client-invites`).set(bearer(a.owner)).send(body)).status).toBe(201);
    expect((await api().post(`/api/projects/${p2._id}/client-invites`).set(bearer(a.owner)).send(body)).status).toBe(409);
  });
});

// CONCEPT: cascade-deletes (KL-6)
describe('KL-6: deleting a project removes what hangs off it', () => {
  it('deletes its tasks, client grants and project role overrides, and nothing else', async () => {
    const { owner, org } = await makeTenant();
    const keep = await makeProject(org._id, 'Keep');
    const doomed = await makeProject(org._id, 'Doomed');
    const client = await makeUser(org._id, 'client');
    const member = await makeUser(org._id, 'member');

    await Task.create({ organizationId: org._id, projectId: doomed._id, title: 'gone' });
    await Task.create({ organizationId: org._id, projectId: keep._id, title: 'stays' });
    await ClientAccess.create({ userId: client._id, organizationId: org._id, projectId: doomed._id });
    await ClientAccess.create({ userId: client._id, organizationId: org._id, projectId: keep._id });
    await User.updateOne(
      { _id: member._id },
      { $push: { projectRoles: [{ projectId: doomed._id, role: 'manager' }, { projectId: keep._id, role: 'manager' }] } }
    );

    const res = await api().delete(`/api/projects/${doomed._id}`).set(bearer(owner));
    expect(res.status).toBe(204);

    expect(await Task.countDocuments({ projectId: doomed._id })).toBe(0);
    expect(await ClientAccess.countDocuments({ projectId: doomed._id })).toBe(0);
    const m = await User.findById(member._id);
    expect(m?.projectRoles.map((r) => String(r.projectId))).toEqual([String(keep._id)]);

    expect(await Task.countDocuments({ projectId: keep._id })).toBe(1);
    expect(await ClientAccess.countDocuments({ projectId: keep._id })).toBe(1);
  });

  it("deleting another tenant's project is a 404 and removes nothing", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const foreign = await makeProject(b.org._id);
    await Task.create({ organizationId: b.org._id, projectId: foreign._id, title: 'b task' });
    const res = await api().delete(`/api/projects/${foreign._id}`).set(bearer(a.owner));
    expect(res.status).toBe(404);
    expect(await Task.countDocuments({ projectId: foreign._id })).toBe(1);
  });
});
