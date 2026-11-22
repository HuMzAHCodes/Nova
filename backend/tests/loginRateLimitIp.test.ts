import { vi, describe, it, expect } from 'vitest';
import { api } from './helpers.js';

vi.unmock('../middleware/loginRateLimit.js');

// CONCEPT: login rate limiting (KL-11), the per-IP limit. Many different
// emails from one address (password spraying) are stopped by the IP limit
// even though no single email reaches its own limit.
describe('KL-11: login attempts are limited per IP', () => {
  it('blocks the 21st attempt from one IP across different emails', async () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      const res = await api().post('/api/auth/login').send({ email: `spray${attempt}@example.com`, password: 'whatever-password' });
      expect(res.status).toBe(401);
    }
    const blocked = await api().post('/api/auth/login').send({ email: 'spray21@example.com', password: 'whatever-password' });
    expect(blocked.status).toBe(429);
  });
});
