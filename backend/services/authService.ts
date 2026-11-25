import mongoose from 'mongoose';
import User from '../models/User.js';
import Session from '../models/Session.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';
import { notifyClientJoined } from './notificationService.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken, getTokenExpiry } from '../lib/jwt.js';
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

// CONCEPT: sessions-and-token-revocation. A session id is stored in tokens
// as text; anything that is not a 24-character hex id cannot be one of ours,
// and checking first keeps a malformed value from reaching the database.
const SESSION_ID_PATTERN = /^[0-9a-f]{24}$/i;

type TokenIdentity = { _id: unknown; organizationId: unknown; role: string };

function buildPayload(user: TokenIdentity, sessionId: string) {
  return {
    userId: String(user._id),
    organizationId: String(user.organizationId),
    role: user.role,
    sessionId,
  };
}

// Every successful LOGIN starts a new session (one per device): a database
// record holding only the hash of the current refresh token. The access
// token carries the session id and is rejected once the record is gone.
// NOTE: register does not call this, hard verification means no tokens are
// issued at registration time.
async function startSession(user: TokenIdentity & { organizationId: unknown }) {
  const sessionId = new mongoose.Types.ObjectId();
  const payload = buildPayload(user, String(sessionId));
  const refreshToken = signRefreshToken(payload);

  await Session.create({
    _id: sessionId,
    userId: user._id,
    organizationId: user.organizationId,
    refreshTokenHash: hashToken(refreshToken),
    expiresAt: getTokenExpiry(refreshToken),
  });

  return { accessToken: signAccessToken(payload), refreshToken };
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

  organization.ownerId = user._id as mongoose.Types.ObjectId;
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

  const tokens = await startSession(user);
  return { user, ...tokens };
}

// FLOW: called by authController.refresh, with the refresh token already
// extracted from the httpOnly cookie by the controller.
//
// CONCEPT: sessions-and-token-revocation. The refresh token is ROTATED: each
// use replaces it with a new one and only the newest is accepted. If an
// older token is presented (it was copied, or used twice), the whole session
// is deleted, so the copy and the legitimate holder both have to sign in again.
export async function refresh(refreshToken: string) {
  const invalid = () => new AppError(401, 'Invalid or expired refresh token');

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw invalid();
  }
  if (!payload.sessionId || !SESSION_ID_PATTERN.test(payload.sessionId)) {
    throw invalid();
  }

  const session = await Session.findOne({
    _id: payload.sessionId,
    userId: payload.userId,
    expiresAt: { $gt: new Date() },
  });
  if (!session) {
    throw invalid();
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    throw new AppError(401, 'User no longer exists');
  }

  const newPayload = buildPayload(user, String(session._id));
  const newRefreshToken = signRefreshToken(newPayload);

  // Compare-and-swap: the update only matches while the stored hash is still
  // the hash of the token presented. Of two simultaneous refreshes with the
  // same token, exactly one matches; the other finds nothing and is treated
  // as a replay.
  const rotated = await Session.findOneAndUpdate(
    { _id: session._id, refreshTokenHash: hashToken(refreshToken) },
    { $set: { refreshTokenHash: hashToken(newRefreshToken), expiresAt: getTokenExpiry(newRefreshToken) } }
  );
  if (!rotated) {
    await Session.deleteOne({ _id: session._id });
    throw invalid();
  }

  return { accessToken: signAccessToken(newPayload), refreshToken: newRefreshToken };
}

// FLOW: called by authController.logout. Ends THIS device's session by
// deleting its record, so the access token and the refresh token both stop
// working at once. A missing, expired or invalid token is ignored (there is
// nothing to end), and the session is only deleted when the token's user id
// matches the session's owner.
export async function endSession(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;

  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }
  if (!payload.sessionId || !SESSION_ID_PATTERN.test(payload.sessionId)) return;

  await Session.deleteOne({ _id: payload.sessionId, userId: payload.userId });
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
  }).select('+passwordResetTokenHash +passwordResetExpires +invitePending');

  if (!user) {
    throw new AppError(400, 'Invalid or expired reset token');
  }

  // CONCEPT: notifications. A client who is still marked pending is accepting
  // their invite, not recovering a forgotten password.
  const wasAcceptingInvite = user.role === 'client' && user.invitePending === true;

  user.passwordHash = newPassword; // re-hashed automatically by the pre-save hook
  user.passwordResetTokenHash = undefined; // single-use — clear so it can't be replayed
  user.passwordResetExpires = undefined;
  user.invitePending = false;
  await user.save();

  if (wasAcceptingInvite) {
    await notifyClientJoined(String(user.organizationId), user);
  }
}