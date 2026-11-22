import { vi, describe, it, expect } from 'vitest';
import { api, makeTenant, makeUser } from './helpers.js';

// The shared setup replaces the limiter with a pass-through. This file tests
// the real one, so it undoes that replacement. Each test file gets its own
// module registry, so the counters start at zero here.
vi.unmock('../middleware/loginRateLimit.js');

const WRONG_PASSWORD = 'definitely-wrong-password';
const RIGHT_PASSWORD = 'Password123!'; // the password makeUser stores

// CONCEPT: login rate limiting (KL-11), the per-email limit.
describe('KL-11: login attempts are limited per email as well as per IP', () => {
  it('blocks the 6th failed attempt for one email, other emails are unaffected', async () => {
    const { org } = await makeTenant();
    const victim = await makeUser(org._id, 'member', 'victim@example.com');
    const bystander = await makeUser(org._id, 'member', 'bystander@example.com');

    for (let attempt = 1; attempt <= 5; attempt++) {
      const res = await api().post('/api/auth/login').send({ email: victim.email, password: WRONG_PASSWORD });
      expect(res.status).toBe(401);
    }

    const blocked = await api().post('/api/auth/login').send({ email: victim.email, password: WRONG_PASSWORD });
    expect(blocked.status).toBe(429);

    // even the right password is refused while the email is locked
    const rightButLocked = await api().post('/api/auth/login').send({ email: victim.email, password: RIGHT_PASSWORD });
    expect(rightButLocked.status).toBe(429);

    // a different email from the same IP is still allowed to try
    const other = await api().post('/api/auth/login').send({ email: bystander.email, password: RIGHT_PASSWORD });
    expect(other.status).toBe(200);
  });

  it('the email is matched case-insensitively and ignoring spaces', async () => {
    const { org } = await makeTenant();
    const target = await makeUser(org._id, 'member', 'mixed@example.com');
    const variants = ['mixed@example.com', 'MIXED@example.com', ' Mixed@Example.com ', 'mixed@EXAMPLE.com', 'MiXeD@example.com'];
    for (const variant of variants) {
      expect((await api().post('/api/auth/login').send({ email: variant, password: WRONG_PASSWORD })).status).toBe(401);
    }
    const blocked = await api().post('/api/auth/login').send({ email: target.email, password: WRONG_PASSWORD });
    expect(blocked.status).toBe(429);
  });

  // Request budget: the per-IP limit is 20 for this whole file, and the three
  // tests send 8 + 6 + 6 = 20 requests. Keep that sum at 20 or below when
  // editing them.
  it('successful logins do not use up the allowance', async () => {
    const { org } = await makeTenant();
    const user = await makeUser(org._id, 'member', 'regular@example.com');
    // six successes: more than the five failures the email limit allows
    for (let attempt = 1; attempt <= 6; attempt++) {
      const res = await api().post('/api/auth/login').send({ email: user.email, password: RIGHT_PASSWORD });
      expect(res.status).toBe(200);
    }
  });
});
