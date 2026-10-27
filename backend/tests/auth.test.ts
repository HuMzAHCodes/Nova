import { describe, it, expect } from 'vitest';
import { api, mocks } from './helpers.js';
import User from '../models/User.js';

const creds = { name: 'Ada', email: 'ada@example.com', password: 'Password123!', organizationName: 'Ada Studio' };

describe('auth flow', () => {
  it('register -> verify email -> login returns tokens', async () => {
    const reg = await api().post('/api/auth/register').send(creds);
    expect(reg.status).toBe(201);
    expect(JSON.stringify(reg.body)).not.toMatch(/passwordHash/);

    // login is blocked until the email is verified
    const early = await api().post('/api/auth/login').send({ email: creds.email, password: creds.password });
    expect(early.status).toBe(403);

    const token = mocks.verification().mock.calls[0][1] as string;
    expect((await api().post('/api/auth/verify-email').send({ token })).status).toBe(200);

    const login = await api().post('/api/auth/login').send({ email: creds.email, password: creds.password });
    expect(login.status).toBe(200);
    expect(login.body.data.accessToken).toBeTruthy();
  });

  it('wrong password and unknown email give the same 401', async () => {
    await api().post('/api/auth/register').send(creds);
    const a = await api().post('/api/auth/login').send({ email: creds.email, password: 'nope-nope-nope' });
    const b = await api().post('/api/auth/login').send({ email: 'ghost@example.com', password: 'nope-nope-nope' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error).toBe(b.body.error);
  });

  it('duplicate email is a 409', async () => {
    await api().post('/api/auth/register').send(creds);
    const again = await api().post('/api/auth/register').send({ ...creds, organizationName: 'Other Studio' });
    expect(again.status).toBe(409);
  });

  it('password reset token works once', async () => {
    await api().post('/api/auth/register').send(creds);
    await api().post('/api/auth/forgot-password').send({ email: creds.email });
    const token = mocks.passwordReset().mock.calls[0][1] as string;
    const first = await api().post('/api/auth/reset-password').send({ token, newPassword: 'BrandNew123!' });
    expect(first.status).toBe(200);
    const second = await api().post('/api/auth/reset-password').send({ token, newPassword: 'Another123!' });
    expect(second.status).toBe(400);
    await User.updateOne({ email: creds.email }, { emailVerified: true });
    const login = await api().post('/api/auth/login').send({ email: creds.email, password: 'BrandNew123!' });
    expect(login.status).toBe(200);
  });

  it('forgot-password for an unknown email still answers 200 and sends nothing', async () => {
    const res = await api().post('/api/auth/forgot-password').send({ email: 'ghost@example.com' });
    expect(res.status).toBe(200);
    expect(mocks.passwordReset()).not.toHaveBeenCalled();
  });
});
