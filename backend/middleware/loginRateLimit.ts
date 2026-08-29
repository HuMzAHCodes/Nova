import rateLimit from 'express-rate-limit';

// CONCEPT: jwt-auth-design (login rate limiting). Applied ONLY to
// /auth/login — not a general-purpose API rate limit, which would need
// to be far looser to avoid hampering normal usage. Login attempts
// specifically are the highest-value target for an attacker (brute-force
// a password, or spray common passwords across accounts), so this gets
// its own dedicated, stricter limit.
//
// windowMs: the rolling time window. max: how many requests are allowed
// from the same IP within that window before further attempts are
// rejected with a 429 (Too Many Requests).
//
// NOTE: this limits by IP alone for now. See the concept notes (common
// mistake #5) — IP-only limiting can be bypassed by an attacker spreading
// attempts across many IPs while still targeting one email. A more
// robust version would ALSO track attempts per submitted email, layered
// on top of this — flagged here as a known simplification for now.
export const loginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
  standardHeaders: true, // adds RateLimit-* headers so the client can see its remaining attempts
  legacyHeaders: false,
});