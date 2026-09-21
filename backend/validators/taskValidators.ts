import { z } from 'zod';

// CONCEPT: task-model-design + rest-crud-design (input validation layer).

// Reusable across create/update — a MongoDB ObjectId is a 24-character
// hex string; validating the shape here catches a malformed ID before
// it ever reaches a database query.
const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format');

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(['todo', 'in_progress', 'blocked', 'done']).default('todo'),
  assignedTo: z.array(objectIdSchema).default([]), // array — matches the
                                                     // multi-assignee design
  dueDate: z.coerce.date().optional(), // coerce: accepts an ISO string from
                                        // the request body, converts to a
                                        // real Date
});

export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  status: z.enum(['todo', 'in_progress', 'blocked', 'done']).optional(),
  assignedTo: z.array(objectIdSchema).optional(),
  dueDate: z.coerce.date().optional(),
});

// Allow-list for sorting — see rest-crud-design concept, common mistake #6.
export const TASK_ALLOWED_SORT_FIELDS = ['title', 'status', 'dueDate', 'createdAt', 'updatedAt'] as const;

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;