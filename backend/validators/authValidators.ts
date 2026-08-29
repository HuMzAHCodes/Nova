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

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;