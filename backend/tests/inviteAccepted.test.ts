import { describe, it, expect } from 'vitest';
import { api, bearer, mocks, makeTenant, makeProject, makeUser } from './helpers.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';

// CONCEPT: notifications (invite accepted). A new client is marked
// "invite pending" when invited; the marker is cleared, and the owner and
// admins notified, the first time that client sets a password through the
// invite link. Written before the implementation.

async function staffScenario() {
  const tenant = await makeTenant();
  const admin = await makeUser(tenant.org._id, 'admin');
  const member = await makeUser(tenant.org._id, 'member');
  const project = await makeProject(tenant.org._id);
  return { ...tenant, admin, member, project };
}

// Invites a client through the API and returns the token that was emailed.
async function inviteClientAndGetToken(
  inviter: Parameters<typeof bearer>[0],
  projectId: unknown,
  email: string
) {
  const res = await api()
    .post(`/api/projects/${projectId}/client-invites`)
    .set(bearer(inviter))
    .send({ email, name: 'New Client' });
  expect(res.status).toBe(201);
  const calls = mocks.clientInvite().mock.calls;
  return calls[calls.length - 1][1] as string;
}

describe('notification: a client accepted their invite', () => {
  it('setting a password through the invite link notifies the owner and the admin, not the member', async () => {
    const { owner, admin, member, project } = await staffScenario();
    const token = await inviteClientAndGetToken(owner, project._id, 'newclient@example.com');
    expect(await Notification.countDocuments()).toBe(0); // nothing yet: not accepted

    const res = await api().post('/api/auth/reset-password').send({ token, newPassword: 'ClientPass123!' });
    expect(res.status).toBe(200);

    const recipients = (await Notification.find({ type: 'client_joined' })).map((n) => String(n.userId)).sort();
    expect(recipients).toEqual([String(owner._id), String(admin._id)].sort());
    expect(await Notification.countDocuments({ userId: member._id })).toBe(0);
    const stored = await Notification.findOne({ userId: owner._id });
    expect(stored?.message).toContain('New Client');
  });

  it('the marker is cleared, so a later password reset does not notify again', async () => {
    const { owner, project } = await staffScenario();
    const token = await inviteClientAndGetToken(owner, project._id, 'again@example.com');
    await api().post('/api/auth/reset-password').send({ token, newPassword: 'ClientPass123!' });
    const afterFirst = await Notification.countDocuments();

    // The client later forgets the password and resets it the normal way.
    await api().post('/api/auth/forgot-password').send({ email: 'again@example.com' });
    const resetCalls = mocks.passwordReset().mock.calls;
    const resetToken = resetCalls[resetCalls.length - 1][1] as string;
    const second = await api().post('/api/auth/reset-password').send({ token: resetToken, newPassword: 'Another123!' });

    expect(second.status).toBe(200);
    expect(await Notification.countDocuments()).toBe(afterFirst);
    const fresh = await User.findOne({ email: 'again@example.com' }).select('+invitePending');
    expect(fresh?.invitePending).toBeFalsy();
  });

  it('a normal password reset by a member or a client created without an invite notifies nobody', async () => {
    const { org, owner } = await staffScenario();
    const member = await makeUser(org._id, 'member', 'plainmember@example.com');
    await makeUser(org._id, 'client', 'plainclient@example.com');
    expect(owner).toBeTruthy();

    for (const email of ['plainmember@example.com', 'plainclient@example.com']) {
      await api().post('/api/auth/forgot-password').send({ email });
      const calls = mocks.passwordReset().mock.calls;
      const token = calls[calls.length - 1][1] as string;
      const res = await api().post('/api/auth/reset-password').send({ token, newPassword: 'Another123!' });
      expect(res.status).toBe(200);
    }
    expect(member).toBeTruthy();
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('inviting an existing client to a second project does not mark them pending again', async () => {
    const { owner, project, org } = await staffScenario();
    const token = await inviteClientAndGetToken(owner, project._id, 'twice@example.com');
    await api().post('/api/auth/reset-password').send({ token, newPassword: 'ClientPass123!' });
    const afterAcceptance = await Notification.countDocuments();

    const secondProject = await makeProject(org._id, 'Second project');
    const secondToken = await inviteClientAndGetToken(owner, secondProject._id, 'twice@example.com');
    await api().post('/api/auth/reset-password').send({ token: secondToken, newPassword: 'ClientPass456!' });

    expect(await Notification.countDocuments()).toBe(afterAcceptance);
  });

  it('the pending marker is never exposed in the invite response', async () => {
    const { owner, project } = await staffScenario();
    const res = await api()
      .post(`/api/projects/${project._id}/client-invites`)
      .set(bearer(owner))
      .send({ email: 'shape@example.com', name: 'Shape' });
    expect(JSON.stringify(res.body)).not.toContain('invitePending');
  });
});
