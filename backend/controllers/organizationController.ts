import { Response } from 'express';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { createOrganizationSchema, updateOrganizationSchema } from '../validators/organizationValidators.js';
import * as organizationService from '../services/organizationService.js';

// CONCEPT: thin controllers (see BACKEND_PRACTICES.md and rest-crud-design
// concept). Every function here follows the same shape: parse/validate
// input → call ONE service function → send the response. No business
// logic, no direct database access — that all lives in organizationService.

// FLOW: POST /api/organizations
//   → catchAsync wraps this so any thrown error (e.g. AppError from the
//     service layer, or a zod validation failure) is forwarded to the
//     centralized errorHandler automatically, instead of crashing silently.
export const createOrganization = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  // Throws a ZodError if req.body doesn't match the schema — caught by
  // catchAsync and forwarded to errorHandler, same as any other error.
  const input = createOrganizationSchema.parse(req.body);

  // req.user!._id — the "!" asserts this is defined; by this point,
  // scopeToTenant has already confirmed the request is authenticated.
  const organization = await organizationService.create(req.user!._id, input);

  sendSuccess(res, { organization }, 201); // 201 Created, not 200 — this created a new resource
});

// FLOW: GET /api/organizations/:orgId
//   → scopeToTenant already ran, confirming req.tenantId === :orgId
//   → this controller just fetches and returns; no authorization logic
//     needed here, since scopeToTenant already handled it
export const getOrganization = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const organization = await organizationService.findById(req.tenantId!);
  sendSuccess(res, { organization });
});

// FLOW: PATCH /api/organizations/:orgId
export const updateOrganization = catchAsync(async (req: TenantScopedRequest, res: Response) => {
  const input = updateOrganizationSchema.parse(req.body);
  const organization = await organizationService.update(req.tenantId!, input);
  sendSuccess(res, { organization });
});