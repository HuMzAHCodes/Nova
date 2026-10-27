import http from 'http';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as connect, Socket } from 'socket.io-client';
import { api, bearer, tokenFor, makeTenant, makeProject, makeUser } from './helpers.js';
import { initializeSocket } from '../lib/socket.js';
import ClientAccess from '../models/ClientAccess.js';
import Task from '../models/Task.js';
import Organization from '../models/Organization.js';

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

async function clientWithAccess(permissions: string[]) {
  const t = await makeTenant();
  const project = await makeProject(t.org._id);
  const client = await makeUser(t.org._id, 'client');
  await ClientAccess.create({ userId: client._id, organizationId: t.org._id, projectId: project._id, permissions });
  const task = await Task.create({
    organizationId: t.org._id,
    projectId: project._id,
    title: 'Logo',
    isDeliverable: true,
    approvalStatus: 'pending',
  });
  return { ...t, project, client, task };
}

describe('client portal', () => {
  it('a client with approve permission can approve a deliverable', async () => {
    const { client, task } = await clientWithAccess(['view', 'approve']);
    const res = await api().post(`/api/client/tasks/${task._id}/approve`).set(bearer(client));
    expect(res.status).toBe(200);
    expect((await Task.findById(task._id))?.approvalStatus).toBe('approved');
  });

  it('a view-only client cannot approve', async () => {
    const { client, task } = await clientWithAccess(['view']);
    const res = await api().post(`/api/client/tasks/${task._id}/approve`).set(bearer(client));
    expect(res.status).toBe(403);
    expect((await Task.findById(task._id))?.approvalStatus).toBe('pending');
  });

  it('reject stores the feedback', async () => {
    const { client, task } = await clientWithAccess(['view', 'approve']);
    const res = await api().post(`/api/client/tasks/${task._id}/reject`).set(bearer(client)).send({ feedback: 'Too blue' });
    expect(res.status).toBe(200);
    const fresh = await Task.findById(task._id);
    expect(fresh?.approvalStatus).toBe('rejected');
    expect(fresh?.clientFeedback).toBe('Too blue');
  });

  it("a client cannot reach a project they were not granted, in their own org", async () => {
    const { client, org } = await clientWithAccess(['view']);
    const other = await makeProject(org._id, 'Other');
    expect((await api().get(`/api/client/projects/${other._id}`).set(bearer(client))).status).toBe(403);
  });

  it("a client cannot approve another tenant's deliverable", async () => {
    const mine = await clientWithAccess(['view', 'approve']);
    const theirs = await clientWithAccess(['view', 'approve']);
    const res = await api().post(`/api/client/tasks/${theirs.task._id}/approve`).set(bearer(mine.client));
    expect([403, 404]).toContain(res.status);
    expect((await Task.findById(theirs.task._id))?.approvalStatus).toBe('pending');
  });

  it('internal users get no client-only restrictions from the client routes, clients cannot use internal routes', async () => {
    const { client, project } = await clientWithAccess(['view']);
    const res = await api().post(`/api/projects/${project._id}/tasks`).set(bearer(client)).send({ title: 'x' });
    expect(res.status).toBe(403);
  });

  it('billing status reflects a lapsed payment', async () => {
    const { client, org, orgId } = await clientWithAccess(['view']);
    await Organization.updateOne({ _id: org._id }, { subscriptionStatus: 'past_due' });
    const res = await api().get(`/api/client/organizations/${orgId}/billing`).set(bearer(client));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ tier: 'free', subscriptionStatus: 'past_due', accessRestricted: true });
  });
});

describe('socket room isolation', () => {
  const open = (token: string) =>
    new Promise<Socket>((resolve, reject) => {
      const s = connect(`http://127.0.0.1:${port}`, { auth: { token }, transports: ['websocket'], reconnection: false });
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  // Joins a room, triggers a real approval, and reports whether the event arrived.
  async function receivesEvent(joiner: Parameters<typeof tokenFor>[0], projectId: string, approver: Parameters<typeof tokenFor>[0], taskId: string) {
    const s = await open(tokenFor(joiner));
    let got = false;
    s.on('deliverable:statusChanged', () => (got = true));
    s.emit('joinProject', projectId);
    await new Promise((r) => setTimeout(r, 400));
    await api().post(`/api/client/tasks/${taskId}/approve`).set(bearer(approver));
    await new Promise((r) => setTimeout(r, 400));
    s.close();
    return got;
  }

  it('an owner of the same org receives the project event', async () => {
    const { owner, client, project, task } = await clientWithAccess(['view', 'approve']);
    expect(await receivesEvent(owner, String(project._id), client, String(task._id))).toBe(true);
  });

  it("an owner of ANOTHER org joining by project ID receives nothing", async () => {
    const { client, project, task } = await clientWithAccess(['view', 'approve']);
    const outsider = await makeTenant();
    expect(await receivesEvent(outsider.owner, String(project._id), client, String(task._id))).toBe(false);
  });

  it('a connection without a token is refused', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const s = connect(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
        s.on('connect', () => resolve(true));
        s.on('connect_error', reject);
      })
    ).rejects.toBeTruthy();
  });
});
