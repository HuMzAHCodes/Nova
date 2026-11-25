import { Request, RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import type { Redis } from 'ioredis';
import { getRedisClient } from '../lib/redis.js';
import { RedisRateLimitStore } from '../lib/redisRateLimitStore.js';

// CONCEPT: jwt-auth-design (login rate limiting). Applied ONLY to
// /auth/login, not as a general API limit, which would need to be far
// looser to avoid hampering normal usage. Login attempts are the
// highest-value target for an attacker, so they get dedicated limits.
//
// CONCEPT: login-rate-limiting (KL-11). Two limits work together, because
// each one alone has a hole:
//   - per IP: stops one machine trying many accounts (password spraying).
//     Loose enough that an office or school behind one shared IP is not
//     locked out by a few mistyped passwords.
//   - per email: stops many machines (many IPs) hammering ONE account.
//     Strict, and counts only FAILED attempts, so a person who logs in
//     correctly is never counted against.
// A request must pass both.
//
// Trade-off of the per-email limit: someone can deliberately fail logins for
// another person's email and lock that account for the window (a denial of
// service on one account). Accepted here because it protects against the
// more serious problem, takeover by guessing, and the lock ends by itself.
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS_PER_IP = 20;
const MAX_FAILED_ATTEMPTS_PER_EMAIL = 5;

// Same normalization the login schema applies (trim, lowercase), so
// "Ada@Example.com " and "ada@example.com" count as one account.
function emailFromBody(req: Request): string {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// CONCEPT: redis-rate-limiting. The counters live in Redis when a Redis client
// is given, and in the server's memory when it is not. Memory is fine for one
// server, but a restart resets it and two servers would each count separately
// (an attacker would get the limit once per server). Redis gives one shared
// count.
//
// Fail open: passOnStoreError lets the request through when Redis cannot be
// reached (the error is logged). The alternative, refusing every login while
// Redis is down, would turn a Redis outage into a full login outage.
export function createLoginRateLimit(redisClient: Redis | null): RequestHandler[] {
  const loginIpRateLimit = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_ATTEMPTS_PER_IP,
    message: { success: false, error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true, // adds RateLimit-* headers so the client can see its remaining attempts
    legacyHeaders: false,
    store: redisClient ? new RedisRateLimitStore(redisClient, 'rl:login:ip:') : undefined,
    passOnStoreError: true,
  });

  const loginEmailRateLimit = rateLimit({
    windowMs: WINDOW_MS,
    max: MAX_FAILED_ATTEMPTS_PER_EMAIL,
    message: { success: false, error: 'Too many login attempts. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => emailFromBody(req),
    // A request without a usable email fails validation anyway and is still
    // counted by the IP limit above.
    skip: (req) => emailFromBody(req) === '',
    // Only failed logins use up the allowance.
    skipSuccessfulRequests: true,
    store: redisClient ? new RedisRateLimitStore(redisClient, 'rl:login:email:') : undefined,
    passOnStoreError: true,
  });

  return [loginIpRateLimit, loginEmailRateLimit];
}

// What the app uses: Redis when REDIS_URL is set, memory otherwise.
export const loginRateLimit = createLoginRateLimit(getRedisClient());
