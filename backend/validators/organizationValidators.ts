import { z } from 'zod';

// CONCEPT: input validation as its own dedicated layer (see
// BACKEND_PRACTICES.md — validation lives in validators/, never inline
// inside a controller). These schemas are imported by the controller,
// which parses req.body against them BEFORE calling the service layer —
// so the service layer can always trust the shape of what it receives.

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]+$/, 'slug may only contain lowercase letters, numbers, and hyphens'),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  subscriptionTier: z.enum(['free', 'pro', 'business']).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;