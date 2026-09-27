import { z } from 'zod';

export const createCheckoutSessionSchema = z.object({
  tier: z.enum(['pro', 'business']),
});

export type CreateCheckoutSessionInput = z.infer<typeof createCheckoutSessionSchema>;