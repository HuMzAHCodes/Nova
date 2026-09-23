import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';

// CONCEPT: client-portal-backend. Kept as its own service, separate from
// projectService/taskService, even though it queries the same
// collections — because these functions are ALWAYS scoped by an
// additional constraint (a specific ClientAccess grant), never called
// from any internal-role code path. Keeping them separate mirrors the
// same reasoning that kept ClientAccess a separate collection from
// projectRoles: a Client's access pattern is fundamentally different
// from an internal role's, even when touching the same underlying data.

export async function getProjectForClient(tenantId: string, projectId: string) {
  const project = await Project.findOne({ _id: projectId, organizationId: tenantId });
  if (!project) {
    throw new AppError(404, 'Project not found');
  }
  return project;
}

// CONCEPT: client-portal-backend — filters to isDeliverable: true ONLY.
// This is a server-side filter, not something left to the frontend to
// hide — see the concept notes on why a client-side filter would not be
// a real security boundary here.
export async function listDeliverablesForClient(tenantId: string, projectId: string) {
  const deliverables = await Task.find({
    organizationId: tenantId,
    projectId,
    isDeliverable: true,
  }).sort({ createdAt: -1 });

  return deliverables;
}

// Placeholder until Week 5's real Stripe integration — see the concept
// doc for why building this route shape now, even minimally, is still
// worthwhile.
export async function getBillingStatusForClient(tenantId: string) {
  const organization = await Organization.findById(tenantId);
  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }
  return { subscriptionTier: organization.subscriptionTier };
}