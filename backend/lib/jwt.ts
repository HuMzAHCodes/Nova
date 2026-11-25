import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import env from '../config/env.js';

// CONCEPT: jwt-auth-design (see docs/concepts/jwt-auth-design). This file
// is the ONLY place in the app that directly calls jsonwebtoken's
// sign()/verify() — every other file that needs to create or check a
// token goes through these functions, so the token payload shape and
// signing logic stay in exactly one place.

// The payload shape embedded in every access/refresh token. Deliberately
// minimal — see the concept notes on why sensitive data never belongs in
// a JWT payload (it's encoded, not encrypted; anyone can read it).
export interface JwtPayload {
  userId: string;
  organizationId: string;
  role: string;
  // CONCEPT: sessions-and-token-revocation. The id of the Session record this
  // token belongs to. The middleware accepts the token only while that record
  // exists, which is what makes logout and revocation take effect at once.
  sessionId: string;
}

// @types/jsonwebtoken types `expiresIn` as `number | StringValue`, where
// StringValue is a narrow template-literal type (e.g. "15m", "7d") — not
// a general `string`. Our env values come from zod as plain strings, so
// TypeScript can't verify they match that narrow type at compile time,
// even though they're valid at runtime (values like "15m"/"7d" are
// exactly what the `ms` package — which jsonwebtoken uses internally —
// expects). This cast tells TypeScript to trust that our env values are
// correctly formatted, which our env.ts .default() values guarantee.
const accessTokenOptions: SignOptions = { expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'] };
const refreshTokenOptions: SignOptions = { expiresIn: env.JWT_REFRESH_EXPIRY as SignOptions['expiresIn'] };

// FLOW: called by authService at the end of a successful login/register,
// to produce the pair of tokens sent back to the client.
export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, accessTokenOptions);
}

export function signRefreshToken(payload: JwtPayload): string {
  // A random jwtid makes every refresh token unique. Without it, two tokens
  // signed for the same session within the same second would be identical,
  // and the stored hash could not tell the old one from the new one.
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, { ...refreshTokenOptions, jwtid: crypto.randomUUID() });
}

// Reads the expiry time out of a token we just signed (no verification is
// needed: it is our own token). Used to set the session's expiresAt.
export function getTokenExpiry(token: string): Date {
  const decoded = jwt.decode(token) as { exp: number };
  return new Date(decoded.exp * 1000);
}

// FLOW: called by the `authenticate` middleware on every protected
// request, to verify the access token attached via the Authorization
// header. jwt.verify() checks BOTH the signature (was this token really
// issued by us, unmodified) AND the expiry (is it still valid) in one
// call — throws automatically if either check fails, which catchAsync/
// the calling middleware translates into a 401.
export function verifyAccessToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
}

// FLOW: called by authController.refresh, to verify the refresh token
// read from the httpOnly cookie before issuing a new access token.
export function verifyRefreshToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as JwtPayload;
}