import crypto from 'crypto';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { sendTeamInviteEmail } from '../lib/email.js';
import { TeamInviteInput } from '../validators/teamInviteValidators.js';

// CONCEPT: team-member-invite. Same 7-day-expiry reused-password-reset-
// token mechanism as client invite (see client-portal-backend concept) —
// one token system backing every "invite someone with no password yet"
// flow in the app, rather than three separate ones.
const TEAM_INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// FLOW: called by teamInviteController.inviteTeamMember, itself gated to
// Owner-only via requireRole('owner') at the route level.
//
// NOTE: the "max team members" limit check (checkLimit(organizationId,
// 'teamMembers')) plugs in right here, at the top of this function —
// intentionally not added yet, since the tiered-limits system is the
// next concept to be built. Coming back to add that call once it exists.
export async function inviteTeamMember(organizationId: string, input: TeamInviteInput) {
  const existingUser = await User.findOne({ email: input.email });

  if (existingUser) {
    if (String(existingUser.organizationId) !== String(organizationId)) {
      // CONCEPT notes: safe to reveal this here, unlike password-reset-
      // request — the caller is an authenticated Owner, not an anonymous
      // actor probing for valid emails.
      throw new AppError(409, 'This email is already associated with an account in another organization');
    }
    throw new AppError(409, 'This person is already a member of your organization');
  }

  const organization = await Organization.findById(organizationId);
  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }

  const resetToken = generateToken(); // plain — emailed, never stored
  const resetTokenHash = hashToken(resetToken); // hash — stored

  // passwordHash is a required field on User, but this invitee has no
  // password yet — a random placeholder is written here purely to
  // satisfy that requirement; it's unusable (never revealed, never
  // logged in with) and gets fully overwritten the moment the invitee
  // submits the reset-password flow below.
  const temporaryPasswordHash = crypto.randomBytes(32).toString('hex');

  const user = new User({
    organizationId,
    email: input.email,
    name: input.name,
    role: input.role,
    passwordHash: temporaryPasswordHash,
    emailVerified: true, // proven by successfully using the invite link itself
    passwordResetTokenHash: resetTokenHash,
    passwordResetExpires: new Date(Date.now() + TEAM_INVITE_EXPIRY_MS),
  });
  await user.save();

  await sendTeamInviteEmail(user.email, resetToken, organization.name);

  return user;
}