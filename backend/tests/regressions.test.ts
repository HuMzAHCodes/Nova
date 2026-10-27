import { describe, it, expect } from 'vitest';
import { api, bearer, makeTenant, makeProject, makeUser } from './helpers.js';
import Organization from '../models/Organization.js';
import Task from '../models/Task.js';

const MISSING_ID = '000000000000000000000000';

// CONCEPT: billing-field-protection (KL-1)
describe('KL-1: organization update cannot touch billing fields', () => {
  it('changes the name but ignores subscriptionTier and stripeCustomerId', async () => {
    const { owner, orgId } = await makeTenant('free');
    const res = await api()
      .patch(`/api/organizations/${orgId}`)
      .set(bearer(owner))
      .send({ name: 'Renamed', subscriptionTier: 'business', subscriptionStatus: 'active', stripeCustomerId: 'cus_evil' });
    expect(res.status).toBe(200);
    const fresh = await Organization.findById(orgId);
    expect(fresh?.name).toBe('Renamed');
    expect(fresh?.subscriptionTier).toBe('free');
    expect(fresh?.stripeCustomerId).toBeUndefined();
  });

  it('a body with only billing fields changes nothing', async () => {
    const { owner, orgId } = await makeTenant('free');
    const res = await api().patch(`/api/organizations/${orgId}`).set(bearer(owner)).send({ subscriptionTier: 'business' });
    expect(res.status).toBe(200);
    expect((await Organization.findById(orgId))?.subscriptionTier).toBe('free');
  });
});

// CONCEPT: tenant isolation (scopeToTenant)
describe('tenant isolation on :orgId', () => {
  it("an owner cannot update another organization's name", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const res = await api().patch(`/api/organizations/${b.orgId}`).set(bearer(a.owner)).send({ name: 'Hacked' });
    expect(res.status).toBe(403);
    expect((await Organization.findById(b.orgId))?.name).not.toBe('Hacked');
  });

  it('requests without a token get 401', async () => {
    const { orgId } = await makeTenant();
    expect((await api().get(`/api/organizations/${orgId}`)).status).toBe(401);
  });
});

// CONCEPT: malformed-id-handling (KL-5)
describe('KL-5: malformed IDs give 400, not a hang or 500', () => {
  it('org route with a bad ID', async () => {
    const { owner } = await makeTenant();
    const res = await api().get('/api/projects/abc').set(bearer(owner));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid ID format');
  });

  it('client route with a bad project ID (async middleware path)', async () => {
    const { org } = await makeTenant();
    const client = await makeUser(org._id, 'client');
    const res = await api().get('/api/client/projects/abc').set(bearer(client));
    expect(res.status).toBe(400);
  });

  it('a well-formed but missing ID stays 404', async () => {
    const { owner } = await makeTenant();
    const res = await api().get(`/api/projects/${MISSING_ID}`).set(bearer(owner));
    expect(res.status).toBe(404);
  });
});

// CONCEPT: parent-resource-check (KL-3)
describe('KL-3: tasks only under a project of the caller tenant', () => {
  it('creates a task under an own project', async () => {
    const { owner, org } = await makeTenant();
    const project = await makeProject(org._id);
    const res = await api().post(`/api/projects/${project._id}/tasks`).set(bearer(owner)).send({ title: 'Valid' });
    expect(res.status).toBe(201);
  });

  it('404 for a missing project, nothing written', async () => {
    const { owner } = await makeTenant();
    const res = await api().post(`/api/projects/${MISSING_ID}/tasks`).set(bearer(owner)).send({ title: 'Ghost' });
    expect(res.status).toBe(404);
    expect(await Task.countDocuments()).toBe(0);
  });

  it("404 for another tenant's project, nothing written", async () => {
    const a = await makeTenant();
    const b = await makeTenant();
    const foreign = await makeProject(b.org._id);
    const res = await api().post(`/api/projects/${foreign._id}/tasks`).set(bearer(a.owner)).send({ title: 'Sneaky' });
    expect(res.status).toBe(404);
    expect(await Task.countDocuments()).toBe(0);
  });
});

describe('subscription limits', () => {
  it('free tier allows 3 projects, the 4th gets 403', async () => {
    const { owner, orgId } = await makeTenant('free');
    for (let i = 0; i < 3; i++) {
      const ok = await api().post(`/api/organizations/${orgId}/projects`).set(bearer(owner)).send({ name: `P${i}` });
      expect(ok.status).toBe(201);
    }
    const blocked = await api().post(`/api/organizations/${orgId}/projects`).set(bearer(owner)).send({ name: 'P4' });
    expect(blocked.status).toBe(403);
  });
});
