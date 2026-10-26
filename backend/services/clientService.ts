import Project from '../models/Project.js';
import Task from '../models/Task.js';
import Organization, { IOrganization } from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';
import { getEffectiveTier } from '../lib/getEffectiveTier.js';

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

// CONCEPT: client-billing-status. The only billing information a client may
// see: three derived, client-safe fields. Never the Organization document
// itself, so Stripe IDs and other internals cannot leak.
export interface ClientBillingStatus {
  tier: IOrganization['subscriptionTier'];
  subscriptionStatus: 'active' | 'canceled' | 'past_due' | null;
  accessRestricted: boolean;
}

// CONCEPT: client-billing-status + lapsed-payment-access-restriction.
// tenantId comes from the authenticated user (scopeToTenant), never from
// request input, so a client can only ever read their own organization.
// The tier is the EFFECTIVE tier, so a lapsed Pro organization shows as
// free, matching what checkLimit actually enforces. A missing status (a
// free organization that never subscribed) is NOT treated as restricted.
export async function getBillingStatusForClient(tenantId: string): Promise<ClientBillingStatus> {
  const organization = await Organization.findById(tenantId);
  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }

  const subscriptionStatus = organization.subscriptionStatus ?? null;

  return {
    tier: getEffectiveTier(organization),
    subscriptionStatus,
    accessRestricted: subscriptionStatus === 'past_due' || subscriptionStatus === 'canceled',
  };
}
