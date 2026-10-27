import { z } from 'zod';

// CONCEPT: team-member-invite. Role is restricted to an explicit
// allow-list ('admin' | 'member') rather than excluding 'owner'/'client'
// — see the concept notes on why an allow-list is safer than a deny-list
// here (fails closed if the User.role enum ever grows).
export const teamInviteSchema = z.object({
  // CONCEPT: input-normalization. Trimmed and lowercased before validation,
  // the same way the auth and client-invite schemas do it, so the same person
  // typed in a different case or with stray spaces is the same email.
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1),
  role: z.enum(['admin', 'member']),
});

export type TeamInviteInput = z.infer<typeof teamInviteSchema>;