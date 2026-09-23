import { Response } from 'express';
import { ClientScopedRequest } from '../middleware/scopeToClientProject.js';
import { catchAsync } from '../lib/catchAsync.js';
import { sendSuccess } from '../lib/response.js';
import * as clientService from '../services/clientService.js';
import * as taskService from '../services/taskService.js';
import { z } from 'zod';

// CONCEPT: client-portal-backend. Every function here assumes
// scopeToClientProject has already run and populated req.clientPermissions
// — none of these controllers use requireRole/requireProjectRole at all,
// since those are exclusively for internal roles.

export const getProject = catchAsync(async (req: ClientScopedRequest, res: Response) => {
  const project = await clientService.getProjectForClient(req.tenantId!, req.params.projectId);
  sendSuccess(res, { project });
});

export const listDeliverables = catchAsync(async (req: ClientScopedRequest, res: Response) => {
  const deliverables = await clientService.listDeliverablesForClient(req.tenantId!, req.params.projectId);
  sendSuccess(res, { deliverables });
});

// CONCEPT: client-portal-backend — explicitly checks 'approve' is in the
// Client's resolved permissions before proceeding. A Client with only
// 'view' access is correctly blocked here, even though they passed
// scopeToClientProject (which only confirms THEY have SOME access to
// THIS project, not which specific actions they're allowed).
export const approveDeliverable = catchAsync(async (req: ClientScopedRequest, res: Response) => {
  if (!req.clientPermissions?.includes('approve')) {
    res.status(403).json({ success: false, error: 'Insufficient permissions to approve deliverables' });
    return;
  }

  const task = await taskService.approveDeliverable(req.tenantId!, req.params.taskId);
  sendSuccess(res, { task });
});

const rejectBodySchema = z.object({
  feedback: z.string().trim().max(2000).optional(),
});

export const rejectDeliverable = catchAsync(async (req: ClientScopedRequest, res: Response) => {
  if (!req.clientPermissions?.includes('approve')) {
    // Deliberately the SAME permission ('approve') gates both approving
    // and rejecting — rejecting is still an authorization DECISION on
    // the deliverable, not a passive "view" action, so it requires the
    // same permission level as approving.
    res.status(403).json({ success: false, error: 'Insufficient permissions to reject deliverables' });
    return;
  }

  const { feedback } = rejectBodySchema.parse(req.body);
  const task = await taskService.rejectDeliverable(req.tenantId!, req.params.taskId, feedback);
  sendSuccess(res, { task });
});

// Placeholder until Week 5 — see the concept doc for why this route
// shape is worth establishing now, even before real Stripe data exists.
export const getBillingStatus = catchAsync(async (req: ClientScopedRequest, res: Response) => {
  const billing = await clientService.getBillingStatusForClient(req.tenantId!);
  sendSuccess(res, billing);
});