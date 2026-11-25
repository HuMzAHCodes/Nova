import http from 'http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { Response } from 'supertest';
import { io as connect, Socket } from 'socket.io-client';
import jwt from 'jsonwebtoken';
import { api, mocks, makeTenant, makeUser } from './helpers.js';
import Session from '../models/Session.js';
import { hashToken } from '../lib/tokens.js';
import { initializeSocket } from '../lib/socket.js';
import env from '../config/env.js';

// CONCEPT: sessions-and-token-revocation (KL-7), second part. Written BEFORE
// the implementation. "Log out everywhere", a password reset, and a detected
// replay all end sessions; whenever a session ends, its live socket
// connections are closed too, and a socket cannot connect without a live session.

let server: http.Server;
let port: number;
const openedSockets: Socket[] = [];

beforeAll(async () => {
  server = http.createServer();
  initializeSocket(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  port = (server.address() as { port: number }).port;
});

afterEach(() => {
  openedSockets.splice(0).forEach((socket) => socket.close());
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function cookieValue(response: Response, name = 'refreshToken'): string | undefined {
  const cookies = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const entry = cookies.find((cookie) => cookie.startsWith(`${name}=`));
  return entry?.split(';')[0].slice(name.length + 1);
}

interface LoggedIn {
  accessToken: string;
  refreshToken: string;
}

async function signIn(user: { email: string }): Promise<LoggedIn> {
  const response = await api().post('/api/auth/login').send({ email: user.email, password: 'Password123!' });
  expect(response.status).toBe(200);
  return { accessToken: response.body.data.accessToken, refreshToken: cookieValue(response) as string };
}

// The person starts with no sessions except the ones created by signing in.
async function freshUser() {
  const { org } = await makeTenant();
  const user = await makeUser(org._id, 'admin');
  await Session.deleteMany({ userId: user._id });
  return user;
}

const callProtected = (accessToken: string) =>
  api().get('/api/notifications/unread-count').set('Authorization', `Bearer ${accessToken}`);
const refreshWith = (refreshToken: string) => api().post('/api/auth/refresh').set('Cookie', `refreshToken=${refreshToken}`);
const logoutWith = (refreshToken: string) => api().post('/api/auth/logout').set('Cookie', `refreshToken=${refreshToken}`);
const logoutEverywhere = (accessToken: string) =>
  api().post('/api/auth/logout-all').set('Authorization', `Bearer ${accessToken}`);

function openSocket(accessToken: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(`http://127.0.0.1:${port}`, {
      auth: { token: accessToken },
      transports: ['websocket'],
      reconnection: false,
    });
    openedSockets.push(socket);
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
  });
}

// Resolves true if the server closes this socket within the time limit.
function closedWithin(socket: Socket, milliseconds: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (socket.disconnected) return resolve(true);
    const timer = setTimeout(() => resolve(false), milliseconds);
    socket.on('disconnect', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function requestPasswordReset(user: { email: string }, newPassword: string) {
  await api().post('/api/auth/forgot-password').send({ email: user.email });
  const calls = mocks.passwordReset().mock.calls;
  const token = calls[calls.length - 1][1] as string;
  return api().post('/api/auth/reset-password').send({ token, newPassword });
}

describe('sessions: log out everywhere', () => {
  it('ends every session of the person, and nobody else', async () => {
    const user = await freshUser();
    const stranger = await freshUser();
    const laptop = await signIn(user);
    const phone = await signIn(user);
    const tablet = await signIn(user);
    const strangerLogin = await signIn(stranger);

    const res = await logoutEverywhere(laptop.accessToken);

    expect(res.status).toBe(200);
    expect(cookieValue(res)).toBe('');
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
    for (const device of [laptop, phone, tablet]) {
      expect((await callProtected(device.accessToken)).status).toBe(401);
      expect((await refreshWith(device.refreshToken)).status).toBe(401);
    }
    expect(await Session.countDocuments({ userId: stranger._id })).toBe(1);
    expect((await callProtected(strangerLogin.accessToken)).status).toBe(200);
  });

  it('needs a valid access token', async () => {
    const user = await freshUser();
    const { accessToken } = await signIn(user);

    const withoutToken = await api().post('/api/auth/logout-all');
    await Session.deleteMany({ userId: user._id });
    const withDeadSession = await logoutEverywhere(accessToken);

    expect(withoutToken.status).toBe(401);
    expect(withDeadSession.status).toBe(401);
  });
});

describe('sessions: a password reset ends every session', () => {
  it('signs the person out on all devices, and nobody else', async () => {
    const user = await freshUser();
    const stranger = await freshUser();
    const laptop = await signIn(user);
    const phone = await signIn(user);
    const strangerLogin = await signIn(stranger);

    const reset = await requestPasswordReset(user, 'BrandNew123!');

    expect(reset.status).toBe(200);
    expect(await Session.countDocuments({ userId: user._id })).toBe(0);
    for (const device of [laptop, phone]) {
      expect((await callProtected(device.accessToken)).status).toBe(401);
      expect((await refreshWith(device.refreshToken)).status).toBe(401);
    }
    expect((await callProtected(strangerLogin.accessToken)).status).toBe(200);
  });

  it('a failed reset (bad token) leaves the sessions alone', async () => {
    const user = await freshUser();
    const { accessToken } = await signIn(user);

    const res = await api().post('/api/auth/reset-password').send({ token: 'not-a-real-token', newPassword: 'BrandNew123!' });

    expect(res.status).toBe(400);
    expect((await callProtected(accessToken)).status).toBe(200);
  });
});

describe('sessions: sockets need a live session', () => {
  it('accepts a live session and refuses a deleted one or a token without a session id', async () => {
    const user = await freshUser();
    const live = await signIn(user);
    const dead = await signIn(user);
    const oldFormatToken = jwt.sign(
      { userId: String(user._id), organizationId: String(user.organizationId), role: user.role },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    await Session.deleteOne({ userId: user._id, refreshTokenHash: hashToken(dead.refreshToken) });

    await expect(openSocket(live.accessToken)).resolves.toBeTruthy();
    await expect(openSocket(dead.accessToken)).rejects.toBeTruthy();
    await expect(openSocket(oldFormatToken)).rejects.toBeTruthy();
  });
});

describe('sessions: a socket cannot borrow another person session', () => {
  it('refuses a token whose session id belongs to a different user', async () => {
    const user = await freshUser();
    const other = await freshUser();
    await signIn(user);
    await signIn(other);
    const otherSession = await Session.findOne({ userId: other._id });
    const borrowedToken = jwt.sign(
      {
        userId: String(user._id),
        organizationId: String(user.organizationId),
        role: user.role,
        sessionId: String(otherSession!._id),
      },
      env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    await expect(openSocket(borrowedToken)).rejects.toBeTruthy();
  });
});

describe('sessions: ending a session closes its live sockets', () => {
  it('logout closes this device sockets and leaves the other device connected', async () => {
    const user = await freshUser();
    const laptop = await signIn(user);
    const phone = await signIn(user);
    const laptopSocket = await openSocket(laptop.accessToken);
    const phoneSocket = await openSocket(phone.accessToken);

    await logoutWith(laptop.refreshToken);

    expect(await closedWithin(laptopSocket, 1000)).toBe(true);
    await wait(300);
    expect(phoneSocket.connected).toBe(true);
  });

  it('log out everywhere closes every socket of the person and no one else', async () => {
    const user = await freshUser();
    const stranger = await freshUser();
    const laptop = await signIn(user);
    const phone = await signIn(user);
    const strangerLogin = await signIn(stranger);
    const laptopSocket = await openSocket(laptop.accessToken);
    const phoneSocket = await openSocket(phone.accessToken);
    const strangerSocket = await openSocket(strangerLogin.accessToken);

    await logoutEverywhere(laptop.accessToken);

    expect(await closedWithin(laptopSocket, 1000)).toBe(true);
    expect(await closedWithin(phoneSocket, 1000)).toBe(true);
    await wait(300);
    expect(strangerSocket.connected).toBe(true);
  });

  it('a password reset closes the sockets of the person', async () => {
    const user = await freshUser();
    const { accessToken } = await signIn(user);
    const socket = await openSocket(accessToken);

    await requestPasswordReset(user, 'BrandNew123!');

    expect(await closedWithin(socket, 1000)).toBe(true);
  });

  it('a detected replay closes the sockets of that session', async () => {
    const user = await freshUser();
    const first = await signIn(user);
    const socket = await openSocket(first.accessToken);
    await refreshWith(first.refreshToken);

    const replay = await refreshWith(first.refreshToken);

    expect(replay.status).toBe(401);
    expect(await closedWithin(socket, 1000)).toBe(true);
  });
});
