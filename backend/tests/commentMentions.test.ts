import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import { api, bearer, makeTenant, makeProject, makeUser } from './helpers.js';
import ClientAccess from '../models/ClientAccess.js';
import Comment from '../models/Comment.js';
import Notification from '../models/Notification.js';
import Task from '../models/Task.js';

// CONCEPT: mentions. Written BEFORE the implementation. The client sends a
// list of user ids; the server validates them and sends each mentioned
// person a dedicated notification. Text is never parsed for names.

type Authenticated = Parameters<typeof bearer>[0];

async function scenario() {
  const tenant = await makeTenant();
  const admin = await makeUser(tenant.org._id, 'admin');
  const member = await makeUser(tenant.org._id, 'member'); // assigned to the deliverable
  const memberB = await makeUser(tenant.org._id, 'member');
  const project = await makeProject(tenant.org._id);
  const deliverable = await Task.create({
    organizationId: tenant.org._id,
    projectId: project._id,
    title: 'Logo deliverable',
    isDeliverable: true,
    approvalStatus: 'pending',
    assignedTo: [member._id],
  });
  const grant = (userId: unknown) =>
    ClientAccess.create({
      userId,
      organizationId: tenant.org._id,
      projectId: project._id,
      permissions: ['view'],
    });
  const client = await makeUser(tenant.org._id, 'client');
  const otherClient = await makeUser(tenant.org._id, 'client');
  await grant(client._id);
  await grant(otherClient._id);
  const clientWithoutGrant = await makeUser(tenant.org._id, 'client');
  const outsider = await makeTenant();
  return {
    ...tenant,
    admin,
    member,
    memberB,
    project,
    deliverable,
    client,
    otherClient,
    clientWithoutGrant,
    outsider,
  };
}

const staffPost = (task: { _id: unknown }, user: Authenticated, body: unknown) =>
  api().post(`/api/tasks/${task._id}/comments`).set(bearer(user)).send(body as object);
const clientPost = (task: { _id: unknown }, user: Authenticated, body: unknown) =>
  api().post(`/api/client/tasks/${task._id}/comments`).set(bearer(user)).send(body as object);
const ids = (...users: Array<{ _id: unknown }>) => users.map((user) => String(user._id));
const notificationsOf = (userId: unknown) => Notification.find({ userId });

describe('mentions: staff mentioning staff', () => {
  it('stores the mentions and sends one comment_mention, never a second normal notification', async () => {
    const { deliverable, owner, memberB, member } = await scenario();

    const res = await staffPost(deliverable, owner, { body: 'Can you check this, B?', mentions: ids(memberB, member) });

    expect(res.status).toBe(201);
    expect(res.body.data.comment.mentions.sort()).toEqual(ids(memberB, member).sort());
    // memberB: mentioned only. member: assignee AND mentioned, so still exactly one, of the mention type.
    for (const person of [memberB, member]) {
      const received = await notificationsOf(person._id);
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('comment_mention');
      expect(received[0].message).toContain('Logo deliverable');
      expect(received[0].message).not.toContain('check this');
    }
  });

  it('a mention beats the normal notification, while other assignees still get the normal one', async () => {
    const { deliverable, owner, memberB, member } = await scenario();
    await staffPost(deliverable, owner, { body: 'Hello', mentions: ids(memberB) });
    expect((await notificationsOf(member._id)).map((n) => n.type)).toEqual(['comment_added']);
    expect((await notificationsOf(memberB._id)).map((n) => n.type)).toEqual(['comment_mention']);
  });

  it('a mention of yourself is ignored: stored without you, nobody notified', async () => {
    const { deliverable, memberB } = await scenario();
    const res = await staffPost(deliverable, memberB, { body: 'Note to self', mentions: ids(memberB) });
    expect(res.status).toBe(201);
    expect(res.body.data.comment.mentions).toEqual([]);
    expect(await Notification.countDocuments({ userId: memberB._id })).toBe(0);
  });

  it('duplicate ids count once', async () => {
    const { deliverable, owner, memberB } = await scenario();
    await staffPost(deliverable, owner, { body: 'Twice', mentions: [...ids(memberB), ...ids(memberB)] });
    expect(await Notification.countDocuments({ userId: memberB._id, type: 'comment_mention' })).toBe(1);
  });

  it('accepts 10 mentions and rejects 11', async () => {
    const { deliverable, owner, org } = await scenario();
    const crowd = await Promise.all(Array.from({ length: 11 }, () => makeUser(org._id, 'member')));

    expect((await staffPost(deliverable, owner, { body: 'Ten', mentions: ids(...crowd.slice(0, 10)) })).status).toBe(201);
    expect((await staffPost(deliverable, owner, { body: 'Eleven', mentions: ids(...crowd) })).status).toBe(400);
  });
});

describe('mentions: invalid mentions are rejected, never silently dropped', () => {
  it('a user of another organization, a random id and a malformed id are all 400 and write nothing', async () => {
    const { deliverable, owner, outsider } = await scenario();
    const before = await Comment.countDocuments();

    for (const bad of [ids(outsider.owner), [String(new mongoose.Types.ObjectId())], ['not-an-id']]) {
      const res = await staffPost(deliverable, owner, { body: 'Bad mention', mentions: bad });
      expect(res.status).toBe(400);
    }
    expect(await Comment.countDocuments()).toBe(before);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('one bad id among good ones rejects the whole comment', async () => {
    const { deliverable, owner, memberB, outsider } = await scenario();
    const res = await staffPost(deliverable, owner, { body: 'Mixed', mentions: ids(memberB, outsider.owner) });
    expect(res.status).toBe(400);
    expect(await Comment.countDocuments()).toBe(0);
  });
});

describe('mentions: clients being mentioned', () => {
  it('staff can mention a granted client in a shared comment, who gets a comment_mention', async () => {
    const { deliverable, owner, client } = await scenario();
    const res = await staffPost(deliverable, owner, {
      body: 'Client, please look',
      visibility: 'shared',
      mentions: ids(client),
    });
    expect(res.status).toBe(201);
    const received = await notificationsOf(client._id);
    expect(received.map((n) => n.type)).toEqual(['comment_mention']);
  });

  it('mentioning a client in an internal comment is a 400', async () => {
    const { deliverable, owner, client } = await scenario();
    const res = await staffPost(deliverable, owner, { body: 'Internal', mentions: ids(client) });
    expect(res.status).toBe(400);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('a client without a grant on the project cannot be mentioned, even in a shared comment', async () => {
    const { deliverable, owner, clientWithoutGrant, org } = await scenario();
    const otherProject = await makeProject(org._id, 'Other');
    await ClientAccess.create({
      userId: clientWithoutGrant._id,
      organizationId: org._id,
      projectId: otherProject._id,
      permissions: ['view'],
    }); // a grant on a DIFFERENT project does not count
    const res = await staffPost(deliverable, owner, {
      body: 'Shared',
      visibility: 'shared',
      mentions: ids(clientWithoutGrant),
    });
    expect(res.status).toBe(400);
  });
});

describe('mentions: a client mentioning people', () => {
  it('a client can mention an admin or the owner', async () => {
    const { deliverable, client, admin, owner } = await scenario();
    const res = await clientPost(deliverable, client, { body: 'Hi both', mentions: ids(admin, owner) });
    expect(res.status).toBe(201);
    for (const person of [admin, owner]) {
      expect((await notificationsOf(person._id)).map((n) => n.type)).toEqual(['comment_mention']);
    }
  });

  it('a client cannot mention a member or another client', async () => {
    const { deliverable, client, member, otherClient } = await scenario();
    expect((await clientPost(deliverable, client, { body: 'x', mentions: ids(member) })).status).toBe(400);
    expect((await clientPost(deliverable, client, { body: 'x', mentions: ids(otherClient) })).status).toBe(400);
    expect(await Comment.countDocuments()).toBe(0);
  });
});

describe('mentions: editing', () => {
  it('only people newly added to the mentions are notified; removing notifies nobody', async () => {
    const { deliverable, owner, memberB, admin } = await scenario();
    const created = await staffPost(deliverable, owner, { body: 'Original', mentions: ids(memberB) });
    const commentId = created.body.data.comment._id;
    await Notification.deleteMany({});

    // Keep memberB, add the admin.
    const added = await api()
      .patch(`/api/comments/${commentId}`)
      .set(bearer(owner))
      .send({ body: 'Edited', mentions: ids(memberB, admin) });
    expect(added.status).toBe(200);
    expect(await Notification.countDocuments({ userId: memberB._id })).toBe(0);
    expect((await notificationsOf(admin._id)).map((n) => n.type)).toEqual(['comment_mention']);

    // Remove everyone: nobody is notified, the list is empty.
    await Notification.deleteMany({});
    const removed = await api()
      .patch(`/api/comments/${commentId}`)
      .set(bearer(owner))
      .send({ body: 'Edited again', mentions: [] });
    expect(removed.status).toBe(200);
    expect((await Comment.findById(commentId))?.mentions).toHaveLength(0);
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('an edit without mentions leaves them unchanged and notifies nobody', async () => {
    const { deliverable, owner, memberB } = await scenario();
    const created = await staffPost(deliverable, owner, { body: 'Original', mentions: ids(memberB) });
    await Notification.deleteMany({});

    await api().patch(`/api/comments/${created.body.data.comment._id}`).set(bearer(owner)).send({ body: 'Typo fixed' });

    expect(await Notification.countDocuments()).toBe(0);
    expect((await Comment.findById(created.body.data.comment._id))?.mentions.map(String)).toEqual(ids(memberB));
  });

  it('an invalid mention on edit is a 400 and the comment is unchanged', async () => {
    const { deliverable, owner, outsider } = await scenario();
    const created = await staffPost(deliverable, owner, { body: 'Original' });
    const res = await api()
      .patch(`/api/comments/${created.body.data.comment._id}`)
      .set(bearer(owner))
      .send({ body: 'Changed', mentions: ids(outsider.owner) });
    expect(res.status).toBe(400);
    expect((await Comment.findById(created.body.data.comment._id))?.body).toBe('Original');
  });

  it('editing a shared comment follows the same client rule: a non-granted client stays invalid', async () => {
    const { deliverable, owner, clientWithoutGrant } = await scenario();
    const created = await staffPost(deliverable, owner, { body: 'Shared', visibility: 'shared' });
    const res = await api()
      .patch(`/api/comments/${created.body.data.comment._id}`)
      .set(bearer(owner))
      .send({ body: 'Shared', mentions: ids(clientWithoutGrant) });
    expect(res.status).toBe(400);
  });
});

describe('mentions: the mentionable-users endpoints', () => {
  it('staff get the staff of the organization and the clients granted on the project, never email', async () => {
    const { project, owner, admin, member, memberB, client, otherClient, clientWithoutGrant, outsider } = await scenario();

    const res = await api().get(`/api/projects/${project._id}/mentionable`).set(bearer(member));

    expect(res.status).toBe(200);
    const listed = res.body.data.users.map((user: { _id: string }) => user._id).sort();
    expect(listed).toEqual(ids(owner, admin, member, memberB, client, otherClient).sort());
    expect(listed).not.toContain(String(clientWithoutGrant._id));
    expect(listed).not.toContain(String(outsider.owner._id));
    expect(Object.keys(res.body.data.users[0]).sort()).toEqual(['_id', 'name', 'role']);
    expect(JSON.stringify(res.body)).not.toContain('@example.com');
  });

  it('a project of another organization is a 404', async () => {
    const { project, outsider } = await scenario();
    const res = await api().get(`/api/projects/${project._id}/mentionable`).set(bearer(outsider.owner));
    expect(res.status).toBe(404);
  });

  it('a client gets only owners and admins of the organization', async () => {
    const { project, client, owner, admin } = await scenario();
    const res = await api().get(`/api/client/projects/${project._id}/mentionable`).set(bearer(client));
    expect(res.status).toBe(200);
    const listed = res.body.data.users.map((user: { _id: string }) => user._id).sort();
    expect(listed).toEqual(ids(owner, admin).sort());
    expect(JSON.stringify(res.body)).not.toContain('@example.com');
  });

  it('a client without a grant gets a 404', async () => {
    const { project, clientWithoutGrant } = await scenario();
    const res = await api().get(`/api/client/projects/${project._id}/mentionable`).set(bearer(clientWithoutGrant));
    expect(res.status).toBe(404);
  });

  it('each endpoint refuses the other kind of user', async () => {
    const { project, client, member } = await scenario();
    expect((await api().get(`/api/projects/${project._id}/mentionable`).set(bearer(client))).status).toBe(403);
    expect((await api().get(`/api/client/projects/${project._id}/mentionable`).set(bearer(member))).status).toBe(403);
  });
});
