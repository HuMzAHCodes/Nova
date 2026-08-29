import mongoose from 'mongoose';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../lib/jwt.js';
import { RegisterInput, LoginInput } from '../validators/authValidators.js';

// CONCEPT: layered architecture — this is the ONLY place in the app that
// contains auth business logic. authController stays thin, only calling
// into these functions.

// Small internal helper — every successful auth operation (register,
// login, refresh) ends the same way: sign a fresh token pair from a
// user's current identity. Defined once here rather than duplicated in
// three places.
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
// Organization AND its first User (the Owner) together — this is
// currently the only way to create an Organization at all (the
// organizationController.createOrganization route built in Week 1 still
// has a TODO noting it needs real auth wiring, since it assumed an
// already-authenticated req.user that didn't exist until now).
export async function register(input: RegisterInput) {
  const existingUser = await User.findOne({ email: input.email });
  if (existingUser) {
    throw new AppError(409, 'An account with this email already exists');
  }

  // Slug generation: lowercase, spaces → hyphens, strip anything that
  // isn't a letter/number/hyphen. See organization-user-schema-design
  // concept notes for why slug is reserved on Organization even before
  // it's actively used anywhere yet.
  const slug = input.organizationName
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');

  const existingOrg = await Organization.findOne({ slug });
  if (existingOrg) {
    throw new AppError(409, 'An organization with a similar name already exists');
  }

  // Organization needs an ownerId, but a User needs an organizationId —
  // a circular requirement. Resolved by creating the Organization first
  // with a temporary/placeholder ownerId, then creating the User, then
  // updating the Organization's ownerId to point to the real User.
  // (A multi-document transaction — see FURTHER_IMPLEMENTATION.md —
  // would make this atomic; flagged there as a documented future
  // improvement rather than solved here in Week 2.)
  const organization = await Organization.create({
    name: input.organizationName,
    slug,
    ownerId: new mongoose.Types.ObjectId(), // temporary placeholder
  });

  const user = new User({
    organizationId: organization._id,
    email: input.email,
    passwordHash: input.password, // gets hashed automatically by the pre-save hook on User
    name: input.name,
    role: 'owner',
  });
  await user.save();

  organization.ownerId = user._id as any;
  await organization.save();

  const tokens = issueTokens(user);
  return { user, organization, ...tokens };
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

  // Issues a completely new token pair. NOTE: this is the simpler,
  // non-rotating version described in the jwt-auth-design concept notes —
  // the old refresh token isn't explicitly invalidated here. Refresh
  // token rotation (issuing a new refresh token AND revoking the old one
  // on every use, to detect token theft) is flagged in the concept notes
  // as a more advanced practice worth adding later.
  return issueTokens(user);
}