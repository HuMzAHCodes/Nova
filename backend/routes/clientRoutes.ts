import { Router } from 'express';
import { scopeToTenant } from '../middleware/scopeToTenant.js';
import { scopeToClientProject } from '../middleware/scopeToClientProject.js';
import { resolveProjectIdFromTaskForClient } from '../middleware/resolveProjectIdFromTaskForClient.js';
import {
  getProject,
  listDeliverables,
  approveDeliverable,
  rejectDeliverable,
  getBillingStatus,
} from '../controllers/clientController.js';

// CONCEPT: client-portal-backend. Every route here is under its own
// namespace and uses ONLY scopeToTenant + scopeToClientProject — never
// requireRole/requireProjectRole, which are exclusively for internal
// roles. See the concept doc for why a separate namespace (rather than
// reusing /organizations, /projects, /tasks with conditional logic) is
// the deliberate choice here.

const router = Router();

// Read-only project view — :projectId is directly in the URL, so
// scopeToClientProject can check it immediately, no resolver needed.
router.get('/projects/:projectId', scopeToTenant, scopeToClientProject, getProject);
router.get('/projects/:projectId/deliverables', scopeToTenant, scopeToClientProject, listDeliverables);

// Approve/reject only have :taskId in their URL — resolveProjectIdFromTaskForClient
// bridges that gap before scopeToClientProject runs, exactly mirroring
// resolveProjectIdFromTask's role for internal requireProjectRole checks.
router.post(
  '/tasks/:taskId/approve',
  scopeToTenant,
  resolveProjectIdFromTaskForClient,
  scopeToClientProject,
  approveDeliverable
);
router.post(
  '/tasks/:taskId/reject',
  scopeToTenant,
  resolveProjectIdFromTaskForClient,
  scopeToClientProject,
  rejectDeliverable
);

// Placeholder billing view — org-level, not project-scoped, so no
// scopeToClientProject needed here; any Client role can check their own
// org's subscription tier regardless of which specific project they're
// scoped to. Full implementation arrives in Week 5.
router.get('/organizations/:orgId/billing', scopeToTenant, getBillingStatus);

export default router;