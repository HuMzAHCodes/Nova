import { Response, NextFunction } from 'express';
import { TenantScopedRequest } from './scopeToTenant.js';
import Task from '../models/Task.js';
import { AppError } from '../lib/AppError.js';
import { catchAsync } from '../lib/catchAsync.js';

// CONCEPT: task-model-design + rest-crud-design (flattened URLs) +
// centralized-error-handling (catchAsync). requireProjectRole checks
// req.params.projectId — but flattened task routes (e.g. PATCH
// /tasks/:taskId) only carry :taskId in their URL, per the
// one-level-of-nesting rule that kept Task routes from being nested
// under /projects/:projectId/tasks/:taskId for every operation.
//
// This middleware bridges that gap: it looks up the task, confirms it
// belongs to the current tenant, and INJECTS its projectId into
// req.params.projectId — so requireProjectRole (registered immediately
// after this, in routes/taskRoutes.ts) can then run completely unchanged,
// exactly as it does for genuinely project-nested routes.
//
// Wrapped in catchAsync exactly like an async controller would be — this
// is itself async (a database lookup) and can throw an AppError; without
// catchAsync, that thrown error would never reach errorHandler.
//
// FLOW: must run AFTER scopeToTenant, BEFORE requireProjectRole.
export const resolveProjectIdFromTask = catchAsync(
  async (req: TenantScopedRequest, res: Response, next: NextFunction) => {
    const task = await Task.findOne({ _id: req.params.taskId, organizationId: req.tenantId });

    if (!task) {
      // Reject here rather than letting requireProjectRole fail later with
      // a less accurate error — if the task doesn't exist (or isn't in
      // this tenant), that's a 404, not a permissions question at all.
      throw new AppError(404, 'Task not found');
    }

    req.params.projectId = task.projectId.toString();
    next();
  }
);