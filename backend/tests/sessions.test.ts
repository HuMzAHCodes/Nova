import { describe, it, expect } from 'vitest';
import type { Response } from 'supertest';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { api, makeTenant, makeUser } from './helpers.js';
import Session from '../models/Session.js';
import User from '../models/User.js';
import { hashToken } from '../lib/tokens.js';
import env from '../config/env.js';

// CONCEPT: sessions-and-token-revocation (KL-7). Written BEFORE the
// implementation. Each login is a session record. The access token names
// its session and is rejected once that session is gone. The refresh token
// is rotated on every use; presenting an old one ends the session.

const PROTECTED_URL = '/api/notifications/unread-count';

interface LoggedIn {
  accessToken: string;
  refreshToken: string;
}

function cookieValue(response: Response, name = 'refreshToken'): string | undefined {
  const cookies = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const entry = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return entry?.split(';')[0].slice(name.length + 1);
}

// Signs in through the real endpoint. The helper session that makeUser
// created is removed first so tests count only sessions created by logins.
async function loginAs(user: { _id: unknown; email: string }): Promise<LoggedIn> {
  await Session.deleteMany({ userId: user._id });
  return signInAgain(user);
}

async function signInAgain(user: { email: string }): Promise<LoggedIn> {
  const response = await api().post('/api/auth/login').send({ email: user.email, password: 'Password123!' });
  expect(response.status).toBe(200);
  return { accessToken: response.body.data.accessToken, refreshToken: cookieValue(response) as string };
}

const callProtected = (accessToken: string) => api().get(PROTECTED_URL).set('Authorization', `Bearer ${accessToken}`);
const refreshWith = (refreshToken?: string) => {
  const request = api().post('/api/auth/refresh');
  return refreshToken === undefined ? request : request.set('Cookie', `refreshToken=${refreshToken}`);
};
const logoutWith = (refreshToken?: string) => {
  const request = api().post('/api/auth/logout');
  return refreshToken === undefined ? request : request.set('Cookie', `refreshToken=${refreshToken}`);
};

async function userInTenant() {
  const { org } = await makeTenant();
  return makeUser(org._id, 'admin');
}

describe('sessions: login creates one', () => {
  it('stores a session with only the HASH of the refresh token, and the access token works', async () => {
    const user = await userInTenant();
    const { accessToken, refreshToken } = await loginAs(user);

    const sessions = await Session.find({ userId: user._id });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].refreshTokenHash).toBe(hashToken(refreshToken));
    expect(sessions[0].refreshTokenHash).not.toBe(refreshToken);
    expect(sessions[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await callProtected(accessToken)).status).toBe(200);
  });

  it('two logins make two sessions and both access tokens work (two devices)', async () => {
    const user = await userInTenant();
    const laptop = await loginAs(user);
    const phone = await signInAgain(user);

    expect(await Session.countDocuments({ userId: user._id })).toBe(2);
    expect((await callProtected(laptop.accessToken)).status).toBe(200);
    expect((await callProtected(phone.accessToken)).status).toBe(200);
  });
});

describe('sessions: the access token is only valid while its session exists', () => {
  it('is rejected after the session is deleted', async () => {
    const user = await userInTenant();
    const { accessToken } = await loginAs(user);
    await Session.deleteMany({ userId: user._id });

    const res = await callProtected(accessToken);

    expect(res.status).toBe(401);
  });

  it('is rejected when it has no session id (a token from before this change)', async () => {
    const user = await userInTenant();
    const oldFormatToken = jwt.sign(
      { userId: String(user._id), organizationId: String(user.organizationId), role: user.role },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    expect((await callProtected(oldFormatToken)).status).toBe(401);
  });

  it('is rejected when the session belongs to a different user', async () => {
    const owner = await userInTenant();
    const other = await userInTenant();
    const otherSession = await Session.findOne({ userId: other._id });
    const borrowedToken = jwt.sign(
      {
        userId: String(owner._id),
        organizationId: String(owner.organizationId),
        role: owner.role,
        sessionId: String(otherSession!._id),
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    expect((await callProtected(borrowedToken)).status).toBe(401);
  });

  it('is rejected when the session has expired but the automatic cleanup has not run yet', async () => {
    const user = await userInTenant();
    const { accessToken } = await loginAs(user);
    await Session.updateOne({ userId: user._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await callProtected(accessToken)).status).toBe(401);
  });

  it('is rejected when the session id is not a valid id', async () => {
    const user = await userInTenant();
    const garbageToken = jwt.sign(
      { userId: String(user._id), organizationId: String(user.organizationId), role: user.role, sessionId: 'nope' },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    expect((await callProtected(garbageToken)).status).toBe(401);
  });
});

describe('sessions: refresh rotates the refresh token', () => {
  it('returns a new access token and a NEW refresh token, and stores the new hash', async () => {
    const user = await userInTenant();
    const first = await loginAs(user);

    const res = await refreshWith(first.refreshToken);

    expect(res.status).toBe(200);
    const newRefreshToken = cookieValue(res) as string;
    expect(newRefreshToken).toBeTruthy();
    expect(newRefreshToken).not.toBe(first.refreshToken);
    const session = await Session.findOne({ userId: user._id });
    expect(session!.refreshTokenHash).toBe(hashToken(newRefreshToken));
    expect((await callProtected(res.body.data.accessToken)).status).toBe(200);
    // The session continues: still exactly one.
    expect(await Session.countDocuments({ userId: user._id })).toBe(1);
  });

  it('presenting the OLD refresh token again ends the whole session', async () => {
    const user = await userInTenant();
    const first = await loginAs(user);
    const rotated = await refreshWith(first.refreshToken);
    const newRefreshToken = cookieValue(rotated) as string;

    const replay = await refreshWith(first.refreshToken);

    expect(replay.status).toBe(401);
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
    // Both the new refresh token and the new access token die with it.
    expect((await refreshWith(newRefreshToken)).status).toBe(401);
    expect((await callProtected(rotated.body.data.accessToken)).status).toBe(401);
  });

  // Relies on MongoDB updating one document atomically (findOneAndUpdate with a
  // filter on the stored hash). Stand-in databases without that guarantee can
  // let both requests through.
  it('two refreshes at the same moment with the same token let only one succeed', async () => {
    const user = await userInTenant();
    const { refreshToken } = await loginAs(user);

    const results = await Promise.all([refreshWith(refreshToken), refreshWith(refreshToken)]);

    expect(results.map((result) => result.status).sort()).toEqual([200, 401]);
  });

  it('rejects a missing, malformed or forged refresh token', async () => {
    const user = await userInTenant();
    await loginAs(user);
    const forged = jwt.sign(
      { userId: String(user._id), organizationId: String(user.organizationId), role: user.role, sessionId: String(new mongoose.Types.ObjectId()) },
      'x'.repeat(40),
      { expiresIn: '7d' }
    );

    expect((await refreshWith()).status).toBe(401);
    expect((await refreshWith('not-a-token')).status).toBe(401);
    expect((await refreshWith(forged)).status).toBe(401);
  });

  it('rejects a correctly signed refresh token with a missing or malformed session id', async () => {
    const user = await userInTenant();
    const base = { userId: String(user._id), organizationId: String(user.organizationId), role: user.role };
    const withoutSession = jwt.sign(base, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });
    const malformedSession = jwt.sign({ ...base, sessionId: 'nope' }, env.JWT_REFRESH_SECRET, { expiresIn: '7d' });

    expect((await refreshWith(withoutSession)).status).toBe(401);
    expect((await refreshWith(malformedSession)).status).toBe(401);
    // Logout with such tokens is harmless.
    expect((await logoutWith(withoutSession)).status).toBe(200);
    expect((await logoutWith(malformedSession)).status).toBe(200);
  });

  it('rejects a correctly signed refresh token whose session no longer exists', async () => {
    const user = await userInTenant();
    const { refreshToken } = await loginAs(user);
    await Session.deleteMany({ userId: user._id });

    expect((await refreshWith(refreshToken)).status).toBe(401);
  });

  it('rejects a refresh token whose session has expired', async () => {
    const user = await userInTenant();
    const { refreshToken } = await loginAs(user);
    await Session.updateOne({ userId: user._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    expect((await refreshWith(refreshToken)).status).toBe(401);
  });

  it('removes the session when the user no longer exists', async () => {
    const user = await userInTenant();
    const { refreshToken } = await loginAs(user);
    await User.deleteOne({ _id: user._id });

    const res = await refreshWith(refreshToken);

    expect(res.status).toBe(401);
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
  });
});

describe('sessions: logout ends this device only', () => {
  it('deletes the session, so the access token and the refresh token stop working at once', async () => {
    const user = await userInTenant();
    const { accessToken, refreshToken } = await loginAs(user);

    const res = await logoutWith(refreshToken);

    expect(res.status).toBe(200);
    expect(cookieValue(res)).toBe('');
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
    expect((await callProtected(accessToken)).status).toBe(401);
    expect((await refreshWith(refreshToken)).status).toBe(401);
  });

  it('leaves the same person signed in on their other device', async () => {
    const user = await userInTenant();
    const laptop = await loginAs(user);
    const phone = await signInAgain(user);

    await logoutWith(laptop.refreshToken);

    expect((await callProtected(laptop.accessToken)).status).toBe(401);
    expect((await callProtected(phone.accessToken)).status).toBe(200);
    expect(await Session.countDocuments({ userId: user._id })).toBe(1);
  });

  it('still answers 200 and clears the cookie with no cookie or a bad one, and touches no session', async () => {
    const user = await userInTenant();
    await loginAs(user);

    for (const response of [await logoutWith(), await logoutWith('not-a-token')]) {
      expect(response.status).toBe(200);
      expect(cookieValue(response)).toBe('');
    }
    expect(await Session.countDocuments({ userId: user._id })).toBe(1);
  });

  it('cannot be used to end somebody else session', async () => {
    const victim = await userInTenant();
    const attacker = await userInTenant();
    await loginAs(victim);
    const attackerLogin = await loginAs(attacker);

    await logoutWith(attackerLogin.refreshToken);

    expect(await Session.countDocuments({ userId: victim._id })).toBe(1);
  });
});
