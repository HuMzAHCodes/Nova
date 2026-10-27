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

// CONCEPT: billing-field-protection. This schema is an ALLOW-LIST: only the
// fields named here can ever reach the service, because zod drops every
// other key. Billing fields (subscriptionTier, subscriptionStatus,
// stripeCustomerId) must NEVER be added here — they are written only by
// the Stripe webhook handler in billingService.ts. Listing subscriptionTier
// in this schema once let any owner or admin give their own organization a
// paid plan without paying.
export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
