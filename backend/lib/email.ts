import nodemailer from 'nodemailer';
import env from '../config/env.js';

// CONCEPT: email-verification-password-reset (see docs/concepts/
// email-verification-password-reset). This is the ONLY place in the app
// that directly uses Nodemailer/Gmail SMTP — every caller goes through
// the named send functions below, not the raw transporter.

// A single, reused SMTP connection ("transporter") configured for
// Gmail. GMAIL_APP_PASSWORD is a Gmail-specific app password, NOT the
// real account password — see the concept notes for why Gmail requires
// this distinct credential for SMTP access.
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: env.GMAIL_USER,
    pass: env.GMAIL_APP_PASSWORD,
  },
});

// FLOW: called by authService.register, right after a new user (and
// their verification token) has been created. The link embeds the PLAIN
// token — only its hash is ever stored in the database (see lib/tokens.ts).
export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const verificationLink = `${env.FRONTEND_URL}/verify-email?token=${token}`;

  await transporter.sendMail({
    from: `"Nova" <${env.GMAIL_USER}>`,
    to,
    subject: 'Verify your Nova account',
    html: `
      <p>Welcome to Nova — please confirm your email address to activate your account.</p>
      <p><a href="${verificationLink}">Verify my email</a></p>
      <p>This link expires in 24 hours. If you didn't create a Nova account, you can safely ignore this email.</p>
    `,
  });
}

// FLOW: called by authService.requestPasswordReset. Note the shorter
// stated expiry in the email text (1 hour) versus verification's 24 hours
// — matching the actual expiry set on the token in authService, since a
// reset token is a more immediately powerful credential (grants account
// takeover, not just a verified flag). See the concept notes for why
// these two flows deliberately use different expiry windows.
export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const resetLink = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: `"Nova" <${env.GMAIL_USER}>`,
    to,
    subject: 'Reset your Nova password',
    html: `
      <p>We received a request to reset your Nova password.</p>
      <p><a href="${resetLink}">Reset my password</a></p>
      <p>This link expires in 1 hour. If you didn't request this, you can safely ignore this email — your password will not be changed.</p>
    `,
  });
}

// CONCEPT: client-portal-backend. Reuses the exact same reset-password
// LINK FORMAT and underlying token mechanism as sendPasswordResetEmail —
// only the wording and stated expiry differ, since this is conceptually
// "set your password for the first time" rather than "you forgot your
// password," even though the code path (a hashed, time-limited,
// single-use token) is identical.
export async function sendClientInviteEmail(to: string, token: string, projectName: string): Promise<void> {
  const setPasswordLink = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: `"Nova" <${env.GMAIL_USER}>`,
    to,
    subject: `You've been invited to view "${projectName}" on Nova`,
    html: `
      <p>You've been invited to Nova's client portal for the project "${projectName}".</p>
      <p><a href="${setPasswordLink}">Set your password and get started</a></p>
      <p>This link expires in 7 days.</p>
    `,
  });
}

// CONCEPT: team-member-invite. Same underlying token mechanism again —
// see the concept notes for why one reused system backs every
// "invite someone with no password yet" flow in the app, rather than a
// bespoke one per flow. Distinct only in wording/subject, same as
// sendClientInviteEmail is distinct from sendPasswordResetEmail.
export async function sendTeamInviteEmail(to: string, token: string, organizationName: string): Promise<void> {
  const setPasswordLink = `${env.FRONTEND_URL}/reset-password?token=${token}`;

  await transporter.sendMail({
    from: `"Nova" <${env.GMAIL_USER}>`,
    to,
    subject: `You've been invited to join ${organizationName} on Nova`,
    html: `
      <p>You've been invited to join <strong>${organizationName}</strong> on Nova.</p>
      <p><a href="${setPasswordLink}">Set your password and get started</a></p>
      <p>This link expires in 7 days.</p>
    `,
  });
}