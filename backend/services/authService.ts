import mongoose from 'mongoose';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { sendVerificationEmail, sendPasswordResetEmail } from '../lib/email.js';
import { RegisterInput, LoginInput } from '../validators/authValidators.js';

// CONCEPT: layered architecture — this is the ONLY place in the app that
// contains auth business logic. authController stays thin, only calling
// into these functions.

const EMAIL_VERIFICATION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
const PASSWORD_RESET_EXPIRY_MS = 60 * 60 * 1000; // 1 hour — shorter than
// verification, deliberately: a reset token is more immediately
// powerful (grants account takeover), see the concept notes.

// Small internal helper — every successful LOGIN operation ends the same
// way: sign a fresh token pair from a user's current identity.
// NOTE: register no longer calls this directly — see register() below,
// hard verification means no tokens are issued at registration time.
function issueTokens(user: { _id: unknown; organizationId: unknown; role: string }) {
  const payload = {
    userId: String(user._id),
    organizationId: String(user.organizationId),
    role: user.role,
  };
  return {
    accessToken: signAccessToken(payload),
    refreshToken: signRefreshToken(payload),
  };
}

// FLOW: called by authController.register. Creates a brand-new
// Organization AND its first User (the Owner) together. CONCEPT:
// email-verification-password-reset (hard verification) — does NOT
// issue access/refresh tokens. The user cannot log in until they verify
// their email via the link this function sends.
export async function register(input: RegisterInput) {
  const existingUser = await User.findOne({ email: input.email });
  if (existingUser) {
    throw new AppError(409, 'An account with this email already exists');
  }

  const slug = input.organizationName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const existingOrg = await Organization.findOne({ slug });
  if (existingOrg) {
    throw new AppError(409, 'An organization with a similar name already exists');
  }

  const organization = await Organization.create({
    name: input.organizationName,
    slug,
    ownerId: new mongoose.Types.ObjectId(), // temporary placeholder — see below
  });

  const verificationToken = generateToken(); // plain — emailed, never stored
  const verificationTokenHash = hashToken(verificationToken); // hash — stored

  const user = new User({
    organizationId: organization._id,
    email: input.email,
    passwordHash: input.password, // gets hashed automatically by the pre-save hook on User
    name: input.name,
    role: 'owner',
    emailVerified: false,
    emailVerificationTokenHash: verificationTokenHash,
    emailVerificationExpires: new Date(Date.now() + EMAIL_VERIFICATION_EXPIRY_MS),
  });
  await user.save();

  organization.ownerId = user._id as any;
  await organization.save();

  await sendVerificationEmail(user.email, verificationToken);

  // No tokens returned — the caller (authController) responds with a
  // "check your email" message, not login credentials.
  return { user, organization };
}

// FLOW: called by authController.verifyEmail, when the user clicks the
// emailed link and submits its token.
export async function verifyEmail(submittedToken: string) {
  const tokenHash = hashToken(submittedToken);

  // The hash + expiry check both happen IN the query itself — there's no
  // separate "look up the user, then compare" step, since the token is
  // the only identifying value available at this point (see concept
  // notes for why this differs from login, which identifies the user by
  // email first).
  const user = await User.findOne({
    emailVerificationTokenHash: tokenHash,
    emailVerificationExpires: { $gt: new Date() },
  }).select('+emailVerificationTokenHash +emailVerificationExpires');

  if (!user) {
    throw new AppError(400, 'Invalid or expired verification token');
  }

  user.emailVerified = true;
  user.emailVerificationTokenHash = undefined; // single-use — clear so it can't be replayed
  user.emailVerificationExpires = undefined;
  await user.save();

  return { user };
}

// FLOW: called by authController.login.
export async function login(input: LoginInput) {
  // .select('+passwordHash') is required here because the User schema
  // marks passwordHash as select: false by default — see models/User.ts.
  const user = await User.findOne({ email: input.email }).select('+passwordHash');

  if (!user) {
    // Deliberately the SAME error message as a wrong password below —
    // never reveal whether the failure was "no such email" vs "wrong
    // password," which would let an attacker enumerate valid emails.
    throw new AppError(401, 'Invalid email or password');
  }

  const isValidPassword = await user.comparePassword(input.password);
  if (!isValidPassword) {
    throw new AppError(401, 'Invalid email or password');
  }

  // CONCEPT: email-verification-password-reset (hard verification).
  // Checked AFTER password verification (so we don't reveal "this
  // account exists and just needs verifying" to someone with a wrong
  // password), but BEFORE any tokens are issued — an unverified user
  // gets no access no matter how correct their password is.
  if (!user.emailVerified) {
    throw new AppError(403, 'Please verify your email before logging in');
  }

  const tokens = issueTokens(user);
  return { user, ...tokens };
}

// FLOW: called by authController.refresh, with the refresh token already
// extracted from the httpOnly cookie by the controller.
export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(401, 'Invalid or expired refresh token');
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    throw new AppError(401, 'User no longer exists');
  }

  return issueTokens(user);
}

// FLOW: called by authController.requestPasswordReset. CONCEPT:
// email-verification-password-reset, common mistake #1 — deliberately
// does NOT reveal whether a matching account was found. The caller
// always gets the same generic response regardless of what happens here;
// the email is only actually sent if a user genuinely exists.
export async function requestPasswordReset(email: string): Promise<void> {
  const user = await User.findOne({ email });
  if (!user) {
    return; // silently no-op — see the "why" above
  }

  const resetToken = generateToken();
  user.passwordResetTokenHash = hashToken(resetToken);
  user.passwordResetExpires = new Date(Date.now() + PASSWORD_RESET_EXPIRY_MS);
  await user.save();

  await sendPasswordResetEmail(user.email, resetToken);
}

// FLOW: called by authController.resetPassword, with the submitted
// token and new password.
export async function resetPassword(submittedToken: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(submittedToken);

  const user = await User.findOne({
    passwordResetTokenHash: tokenHash,
    passwordResetExpires: { $gt: new Date() },
  }).select('+passwordResetTokenHash +passwordResetExpires');

  if (!user) {
    throw new AppError(400, 'Invalid or expired reset token');
  }

  user.passwordHash = newPassword; // re-hashed automatically by the pre-save hook
  user.passwordResetTokenHash = undefined; // single-use — clear so it can't be replayed
  user.passwordResetExpires = undefined;
  await user.save();
}