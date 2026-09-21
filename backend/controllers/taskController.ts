import { Response } from 'express';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { createTaskSchema, updateTaskSchema } from '../validators/taskValidators.js';
import { paginationQuerySchema } from '../validators/paginationValidators.js';
import * as taskService from '../services/taskService.js';

// CONCEPT: task-model-design — notice NO permission-checking logic
// appears anywhere in this file. Access control is fully handled by
// requireProjectRole at the ROUTE level (see routes/taskRoutes.ts) —
// this controller only orchestrates, exactly like every other controller
// in the app.

// FLOW: POST /projects/:projectId/tasks
export const createTask = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = createTaskSchema.parse(req.body);
  const task = await taskService.create(req.tenantId!, req.params.projectId, input);
  sendSuccess(res, { task }, 201);
});

// FLOW: GET /projects/:projectId/tasks?page=&limit=&sort=
export const listTasks = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const query = paginationQuerySchema.parse(req.query);
  const { tasks, pagination } = await taskService.listForProject(req.tenantId!, req.params.projectId, query);
  res.status(200).json({ success: true, data: { tasks }, pagination });
});

// FLOW: GET /tasks/:taskId — flattened, not nested under /projects/:projectId,
// per the rest-crud-design concept's one-level-of-nesting rule. Tenant
// safety still guaranteed: taskService.findById filters by BOTH _id and
// organizationId.
export const getTask = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const task = await taskService.findById(req.tenantId!, req.params.taskId);
  sendSuccess(res, { task });
});

export const updateTask = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = updateTaskSchema.parse(req.body);
  const task = await taskService.update(req.tenantId!, req.params.taskId, input);
  sendSuccess(res, { task });
});

export const deleteTask = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  await taskService.remove(req.tenantId!, req.params.taskId);
  sendSuccess(res, null, 204);
});