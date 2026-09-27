import Organization from '../models/Organization.js';
import Project from '../models/Project.js';
import User from '../models/User.js';
import { AppError } from './AppError.js';
import { SUBSCRIPTION_LIMITS, LimitedResource } from '../config/subscriptionLimits.js';

const RESOURCE_LABELS: Record<LimitedResource, string> = {
  projects: 'projects',
  clients: 'clients',
  teamMembers: 'team members',
};

// CONCEPT: usage-limits-tier-gating. The single shared guard every
// resource-creating service calls before writing a new Project, Client,
// or Team Member. Pure guard — no side effects, only throws or returns.
export async function checkLimit(organizationId: string, resource: LimitedResource): Promise<void> {
  const organization = await Organization.findById(organizationId);
  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }

  const limit = SUBSCRIPTION_LIMITS[organization.subscriptionTier][resource];

  if (limit === Infinity) {
    return; // business tier — no need to even count
  }

  const currentCount = await countResource(organizationId, resource);

  if (currentCount >= limit) {
    throw new AppError(
      403,
      `Your current plan allows up to ${limit} ${RESOURCE_LABELS[resource]}. Upgrade your plan to add more.`
    );
  }
}

// Clients and team members are both stored as User documents,
// distinguished only by role — see models/User.ts. Owner/Admin/Member
// count as "team members"; Client is counted separately.
async function countResource(organizationId: string, resource: LimitedResource): Promise<number> {
  switch (resource) {
    case 'projects':
      return Project.countDocuments({ organizationId });
    case 'clients':
      return User.countDocuments({ organizationId, role: 'client' });
    case 'teamMembers':
      return User.countDocuments({ organizationId, role: { $in: ['owner', 'admin', 'member'] } });
  }
}