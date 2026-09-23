import User from '../models/User.js';
import Project from '../models/Project.js';
import ClientAccess from '../models/ClientAccess.js';
import { AppError } from '../lib/AppError.js';
import { generateToken, hashToken } from '../lib/tokens.js';
import { sendClientInviteEmail } from '../lib/email.js';
import { InviteClientInput } from '../validators/clientInviteValidators.js';

// CONCEPT: client-portal-backend (client invite flow). Longer than
// password-reset's 1 hour — see the concept doc for why: an invite may
// sit unopened far longer than someone actively trying to recover a
// forgotten password would realistically wait.
const CLIENT_INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// FLOW: called by clientInviteController.inviteClient, itself only
// reachable by Owner/Admin (enforced at the route level via requireRole,
// not here — this service assumes the caller is already authorized).
export async function inviteClient(tenantId: string, projectId: string, input: InviteClientInput) {
  const project = await Project.findOne({ _id: projectId, organizationId: tenantId });
  if (!project) {
    throw new AppError(404, 'Project not found');
  }

  let user = await User.findOne({ email: input.email });

  if (user && user.role !== 'client') {
    // CONCEPT: client-portal-backend — deliberately rejected, not
    // silently converted. See the concept doc's Q&A for why conflating
    // an internal role with Client access on the same account would
    // blur a distinction the whole ClientAccess design exists to keep clear.
    throw new AppError(409, 'This email belongs to an existing internal user and cannot be invited as a client');
  }

  if (!user) {
    // A random, unguessable placeholder — never communicated to anyone,
    // never meant to be used to log in directly. Hashed automatically by
    // the User model's existing pre-save hook, same as any real password.
    const placeholderPassword = generateToken();

    user = new User({
      organizationId: tenantId,
      email: input.email,
      passwordHash: placeholderPassword,
      name: input.name,
      role: 'client',
      // CONCEPT: client-portal-backend — set true directly, skipping the
      // separate verification email. See the concept doc for why: the
      // client is about to go through a password-setup link anyway,
      // which itself proves they control the inbox.
      emailVerified: true,
    });
    await user.save();
  }

  const existingAccess = await ClientAccess.findOne({ userId: user._id, projectId });
  if (existingAccess) {
    throw new AppError(409, 'This client already has access to this project');
  }

  await ClientAccess.create({
    userId: user._id,
    organizationId: tenantId,
    projectId,
    permissions: input.permissions,
  });

  // CONCEPT: client-portal-backend — reuses the exact same hashed-token
  // mechanism built for password reset (see email-verification-password-reset
  // concept), just with a longer expiry and different email wording.
  const setPasswordToken = generateToken();
  user.passwordResetTokenHash = hashToken(setPasswordToken);
  user.passwordResetExpires = new Date(Date.now() + CLIENT_INVITE_EXPIRY_MS);
  await user.save();

  await sendClientInviteEmail(user.email, setPasswordToken, project.name);

  return { user, project };
}