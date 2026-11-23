import { z } from 'zod';

// CONCEPT: comments. Plain text only, trimmed, 1 to 2000 characters. The
// text is never interpreted as HTML or parsed for anything.
const commentBodySchema = z.string().trim().min(1).max(2000);

// CONCEPT: mentions. A list of user ids (not names parsed from the text), at
// most 10. Whether each id may be mentioned in THIS comment is decided by the
// service, which knows the author, the visibility and the project.
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');
const mentionsSchema = z.array(objectIdSchema).max(10);

// Staff may choose the visibility; the default (internal) is applied by the
// service. The service also forces 'internal' on tasks that are not deliverables.
export const createCommentSchema = z.object({
  body: commentBodySchema,
  visibility: z.enum(['internal', 'shared']).optional(),
  mentions: mentionsSchema.default([]),
});

// CONCEPT: comment-visibility. A client has no say in visibility: every client
// comment is shared. Unknown keys such as "visibility" are stripped by zod
// before they reach the service, so a forged value is ignored, not trusted.
export const createClientCommentSchema = z.object({
  body: commentBodySchema,
  mentions: mentionsSchema.default([]),
});

// On edit, sending mentions REPLACES the list (only newly added people are
// notified); leaving it out keeps the list as it is.
export const updateCommentSchema = z.object({
  body: commentBodySchema,
  mentions: mentionsSchema.optional(),
});

// A thread reads top to bottom, so pages are larger than for other lists.
export const threadQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

export type CreateCommentInput = z.infer<typeof createCommentSchema>;
export type CreateClientCommentInput = z.infer<typeof createClientCommentSchema>;
export type UpdateCommentInput = z.infer<typeof updateCommentSchema>;
export type ThreadQuery = z.infer<typeof threadQuerySchema>;
