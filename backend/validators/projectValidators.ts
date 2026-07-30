import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
});

// Allow-list of fields Projects can actually be sorted/filtered by —
// referenced by the service layer so a client can never request a sort
// on a field that doesn't exist or isn't indexed (see the rest-crud-design
// concept notes, common mistake #6).
export const PROJECT_ALLOWED_SORT_FIELDS = ['name', 'createdAt', 'updatedAt'] as const;

export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;