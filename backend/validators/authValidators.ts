import { z } from 'zod';

// CONCEPT: input validation layer (see BACKEND_PRACTICES.md). These
// schemas are parsed by authController BEFORE authService ever runs —
// authService can always trust the shape of what it receives.

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  // A new registration creates the FIRST user of a brand-new organization
  // (the Owner) — organizationName is used to create that Organization
  // in the same operation. Joining an EXISTING org via invite is a
  // separate, later flow (not built yet), not covered by this schema.
  organizationName: z.string().trim().min(1).max(200),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1, 'Password is required'),
});

// CONCEPT: email-verification-password-reset. These three schemas cover
// the token-based flows — note none of them validate the TOKEN's format
// beyond being a non-empty string, since it's an opaque random value
// (see lib/tokens.ts), not something with a structure to validate.
export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const requestPasswordResetSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type RequestPasswordResetInput = z.infer<typeof requestPasswordResetSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;