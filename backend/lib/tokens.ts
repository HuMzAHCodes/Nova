import crypto from 'crypto';

// CONCEPT: email-verification-password-reset (see docs/concepts/
// email-verification-password-reset). This is the ONLY place in the app
// that generates or hashes verification/reset tokens — every caller
// (authService's register/verifyEmail/requestPasswordReset/resetPassword)
// goes through these two functions.

// Generates a cryptographically random, high-entropy plain token — this
// is the value that gets emailed to the user (embedded in a link). It is
// NEVER stored anywhere; only its hash is stored (see hashToken below).
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// Hashes a plain token with SHA-256 for storage/comparison. Deliberately
// a FAST hash, unlike bcrypt for passwords — see the concept notes for
// why: these tokens are high-entropy random values, not human-chosen
// passwords, so a fast hash doesn't meaningfully weaken brute-force
// resistance the way it would for passwords, and avoids unnecessary
// latency on every verification/reset attempt.
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}