import { describe, it, expect } from 'vitest';
import { api, bearer, makeTenant } from './helpers.js';

// CONCEPT: dead-route-removal (KL-8). Registration creates the
// organization, and a user belongs to exactly one, so a separate
// "create organization" route could only produce organizations nobody owns.
describe('KL-8: the leftover create-organization route is gone', () => {
  it('POST /api/organizations answers 404', async () => {
    const { owner } = await makeTenant();
    const res = await api().post('/api/organizations').set(bearer(owner)).send({ name: 'Second Org', slug: 'second-org' });
    expect(res.status).toBe(404);
  });

  it('reading and renaming your own organization still works', async () => {
    const { owner, orgId } = await makeTenant();
    expect((await api().get(`/api/organizations/${orgId}`).set(bearer(owner))).status).toBe(200);
    const rename = await api().patch(`/api/organizations/${orgId}`).set(bearer(owner)).send({ name: 'Renamed' });
    expect(rename.status).toBe(200);
  });
});
