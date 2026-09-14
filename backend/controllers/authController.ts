import { Request, Response } from 'express';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
} from '../validators/authValidators.js';
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
//   2. Delegate to authService (creates Organization + Owner User,
//      sends a verification email — does NOT issue tokens; see
//      CONCEPT: email-verification-password-reset, hard verification)
//   3. Respond with a "check your email" message — no accessToken, no
//      refresh cookie, since the user cannot log in yet
export const register = catchAsync(async (req: Request, res: Response) => {
  const input = registerSchema.parse(req.body);
  const { user, organization } = await authService.register(input);

  sendSuccess(
    res,
    {
      message: 'Registration successful. Please check your email to verify your account before logging in.',
      user: { id: user._id, name: user.name, email: user.email },
      organization: { id: organization._id, name: organization.name, slug: organization.slug },
    },
    201
  );
});

// FLOW: GET or POST /auth/verify-email — the endpoint the emailed link
// points to (frontend reads the ?token= query param and submits it here,
// or this could be a direct GET depending on frontend implementation —
// left as POST with token in body for consistency with our other
// validated-body endpoints).
export const verifyEmail = catchAsync(async (req: Request, res: Response) => {
  const { token } = verifyEmailSchema.parse(req.body);
  await authService.verifyEmail(token);
  sendSuccess(res, { message: 'Email verified successfully. You can now log in.' });
});

// FLOW: POST /auth/forgot-password
export const requestPasswordReset = catchAsync(async (req: Request, res: Response) => {
  const { email } = requestPasswordResetSchema.parse(req.body);
  await authService.requestPasswordReset(email);

  // CONCEPT: email-verification-password-reset, common mistake #1 — this
  // exact same message is returned whether or not a matching account
  // was found, so this endpoint can never be used to enumerate which
  // emails have accounts.
  sendSuccess(res, { message: 'If an account with that email exists, a password reset link has been sent.' });
});

// FLOW: POST /auth/reset-password
export const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const { token, newPassword } = resetPasswordSchema.parse(req.body);
  await authService.resetPassword(token, newPassword);
  sendSuccess(res, { message: 'Password reset successfully. You can now log in with your new password.' });
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