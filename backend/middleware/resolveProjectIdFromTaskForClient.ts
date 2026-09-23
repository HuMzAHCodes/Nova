import { Response, NextFunction } from 'express';
import { TenantScopedRequest } from './scopeToTenant.js';
import Task from '../models/Task.js';
import { AppError } from '../lib/AppError.js';
import { catchAsync } from '../lib/catchAsync.js';

// CONCEPT: client-portal-backend + task-model-design. The client-facing
// approve/reject routes (POST /client/tasks/:taskId/approve|reject) only
// carry :taskId in their URL, but scopeToClientProject (registered right
// after this) needs :projectId to check the Client's ClientAccess grant.
// This is the EXACT SAME shape of problem resolveProjectIdFromTask solved
// for internal requireProjectRole checks in Week 3 — same fix, applied
// in this new context. See the client-portal-backend concept notes for
// why this pattern recurring here (not just in Week 3) is worth
// recognizing as a general pattern, not a one-off.
export const resolveProjectIdFromTaskForClient = catchAsync(
  async (req: TenantScopedRequest, res: Response, next: NextFunction) => {
    const task = await Task.findOne({ _id: req.params.taskId, organizationId: req.tenantId });

    if (!task) {
      throw new AppError(404, 'Task not found');
    }

    req.params.projectId = task.projectId.toString();
    next();
  }
);