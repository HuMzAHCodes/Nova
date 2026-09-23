import { z } from 'zod';

// CONCEPT: client-portal-backend (client invite flow).
export const inviteClientSchema = z.object({
  name: z.string().trim().min(1).max(100), // only used if a new User needs
                                             // to be created — ignored if
                                             // the email already belongs
                                             // to an existing Client user
  email: z.string().trim().toLowerCase().email(),
  permissions: z.array(z.enum(['view', 'approve'])).min(1).default(['view']),
});

export type InviteClientInput = z.infer<typeof inviteClientSchema>;