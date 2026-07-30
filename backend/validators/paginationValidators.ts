import { z } from 'zod';

// CONCEPT: pagination/filtering/sorting conventions (see docs/concepts/
// rest-crud-design). Every list endpoint in the app validates its query
// params through THIS shared schema before touching the database —
// closing off the "common mistake" of trusting raw query strings
// (unbounded ?limit=, unvalidated ?sort= fields) documented in the
// concept's -notes.md file.
//
// z.coerce.number() converts the incoming string query param into a real
// number (all query params arrive as strings). .max(100) on limit is the
// hard cap preventing a client from requesting an unreasonably large page.
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().optional(),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;