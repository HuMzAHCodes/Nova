import crypto from 'crypto';
import User from '../models/User.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { sendTeamInviteEmail } from '../lib/email.js';
import { checkLimit } from '../lib/checkLimit.js';
import { TeamInviteInput } from '../validators/teamInviteValidators.js';

const TEAM_INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// FLOW: called by teamInviteController.inviteTeamMember, itself gated to
// Owner-only via requireRole('owner') at the route level.
export async function inviteTeamMember(organizationId: string, input: TeamInviteInput) {
  const existingUser = await User.findOne({ email: input.email });

  if (existingUser) {
    if (String(existingUser.organizationId) !== String(organizationId)) {
      throw new AppError(409, 'This email is already associated with an account in another organization');
    }
    throw new AppError(409, 'This person is already a member of your organization');
  }

  // CONCEPT: usage-limits-tier-gating. Checked AFTER the duplicate-email
  // check (no point rejecting for "plan full" when it's actually a
  // duplicate), BEFORE any DB write.
  await checkLimit(organizationId, 'teamMembers');

  const organization = await Organization.findById(organizationId);
  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }

  const resetToken = generateToken();
  const resetTokenHash = hashToken(resetToken);
  const temporaryPasswordHash = crypto.randomBytes(32).toString('hex');

  const user = new User({
    organizationId,
    email: input.email,
    name: input.name,
    role: input.role,
    passwordHash: temporaryPasswordHash,
    emailVerified: true,
    passwordResetTokenHash: resetTokenHash,
    passwordResetExpires: new Date(Date.now() + TEAM_INVITE_EXPIRY_MS),
  });
  await user.save();

  await sendTeamInviteEmail(user.email, resetToken, organization.name);

  return user;
}