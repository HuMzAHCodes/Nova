import { Response } from 'express';
import { TenantScopedRequest } from '../middleware/scopeToTenant.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import { updateOrganizationSchema } from '../validators/organizationValidators.js';
import * as organizationService from '../services/organizationService.js';

// CONCEPT: thin controllers (see BACKEND_PRACTICES.md and rest-crud-design
// concept). Every function here follows the same shape: parse/validate
// input → call ONE service function → send the response. No business
// logic, no direct database access — that all lives in organizationService.

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