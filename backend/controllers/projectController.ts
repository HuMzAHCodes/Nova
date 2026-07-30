import { Response } from 'express';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { createProjectSchema, updateProjectSchema } from '../validators/projectValidators.js';
import { paginationQuerySchema } from '../validators/paginationValidators.js';
import * as projectService from '../services/projectService.js';

// FLOW: POST /api/organizations/:orgId/projects
//   → scopeToTenant confirms req.tenantId === :orgId
//   → this controller validates the body, then delegates to the service
export const createProject = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = createProjectSchema.parse(req.body);
  const project = await projectService.create(req.tenantId!, input);
  sendSuccess(res, { project }, 201);
});

// FLOW: GET /api/organizations/:orgId/projects?page=&limit=&sort=
//   → validates query params through the shared pagination schema BEFORE
//     they ever reach the service/database layer — see rest-crud-design
//     concept notes for why this matters (common mistake #5).
export const listProjects = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const query = paginationQuerySchema.parse(req.query);
  const { projects, pagination } = await projectService.listForTenant(req.tenantId!, query);

  // Note: pagination metadata sits alongside `data`, not inside it —
  // this is the one deliberate extension to the standard response shape,
  // reserved specifically for list endpoints.
  res.status(200).json({ success: true, data: { projects }, pagination });
});

// FLOW: GET /api/projects/:projectId
//   → notice this route does NOT have :orgId in its path (see
//     rest-crud-design concept — flattening past one level of nesting).
//     Tenant safety is still fully guaranteed here: projectService.findById
//     filters by BOTH _id and organizationId, so a project ID belonging
//     to a different org simply returns "not found," never leaking data.
export const getProject = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const project = await projectService.findById(req.tenantId!, req.params.projectId);
  sendSuccess(res, { project });
});

export const updateProject = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = updateProjectSchema.parse(req.body);
  const project = await projectService.update(req.tenantId!, req.params.projectId, input);
  sendSuccess(res, { project });
});

export const deleteProject = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  await projectService.remove(req.tenantId!, req.params.projectId);
  sendSuccess(res, null, 204); // 204 No Content — successful delete, nothing to return
});