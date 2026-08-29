import { Request, Response } from 'express';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { registerSchema, loginSchema } from '../validators/authValidators.js';
import * as authService from '../services/authService.js';
import env from '../config/env.js';

// CONCEPT: jwt-auth-design (see docs/concepts/jwt-auth-design). This is
// the ONLY place in the app that sets/reads the refresh token cookie —
// keeping cookie handling in the controller (not the service) because
// it's an HTTP-layer concern, not business logic; the service layer
// stays framework-agnostic and only deals with plain values.

// A shared cookie-options object, so the "set" and "clear" cookie calls
// below can never accidentally drift out of sync with each other (e.g.
// clearing a cookie with different options than it was set with silently
// fails to actually clear it in some browsers).
const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true, // invisible to JavaScript — see concept notes on why
  secure: env.NODE_ENV === 'production', // only sent over HTTPS in production; allows plain HTTP in local dev
  sameSite: 'strict' as const, // mitigates CSRF — see concept notes on the tradeoff this introduces
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days, in milliseconds — matches JWT_REFRESH_EXPIRY
};

// FLOW: POST /auth/register
//   1. Validate the request body
//   2. Delegate to authService (creates Organization + Owner User together)
//   3. Set the refresh token as an httpOnly cookie (frontend JS never
//      touches this value directly)
//   4. Return the access token + user/org info in the JSON body (frontend
//      keeps the access token in memory only — never localStorage)
export const register = catchAsync(async (req: Request, res: Response) => {
  const input = registerSchema.parse(req.body);
  const { user, organization, accessToken, refreshToken } = await authService.register(input);

  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

  sendSuccess(
    res,
    {
      accessToken,
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      organization: { id: organization._id, name: organization.name, slug: organization.slug },
    },
    201
  );
});

// FLOW: POST /auth/login — has loginRateLimit applied on the route
// (see routes/authRoutes.ts), so this controller itself doesn't need to
// think about brute-force protection at all; that's handled upstream.
export const login = catchAsync(async (req: Request, res: Response) => {
  const input = loginSchema.parse(req.body);
  const { user, accessToken, refreshToken } = await authService.login(input);

  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

  sendSuccess(res, {
    accessToken,
    user: { id: user._id, name: user.name, email: user.email, role: user.role },
  });
});

// FLOW: POST /auth/refresh — no Authorization header needed (the access
// token is presumably already expired, that's WHY this is being called).
// The browser automatically attaches the httpOnly refresh cookie to this
// request; we read it directly off req.cookies (populated by the
// cookie-parser middleware wired into app.ts).
export const refresh = catchAsync(async (req: Request, res: Response) => {
  const token = req.cookies?.refreshToken;
  if (!token) {
    res.status(401).json({ success: false, error: 'No refresh token provided' });
    return;
  }

  const { accessToken, refreshToken } = await authService.refresh(token);

  // Re-set the cookie with the new refresh token — see the concept notes
  // on refresh token rotation for why re-issuing (rather than reusing the
  // same one) is the more advanced, more secure pattern.
  res.cookie('refreshToken', refreshToken, REFRESH_COOKIE_OPTIONS);

  sendSuccess(res, { accessToken });
});

// FLOW: POST /auth/logout — clears the refresh cookie so the browser
// stops sending it. NOTE: this does NOT invalidate the access token
// already in the frontend's memory (it will simply expire naturally
// within 15 minutes) — true immediate revocation would require a
// server-side token blocklist, which isn't built here; flagged as a
// known simplification, matching the "stateless JWT" tradeoff described
// in the concept notes (fast/scalable, at the cost of no instant revocation).
export const logout = catchAsync(async (req: Request, res: Response) => {
  res.clearCookie('refreshToken', REFRESH_COOKIE_OPTIONS);
  sendSuccess(res, null);
});