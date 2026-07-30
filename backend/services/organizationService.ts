import Organization from '../models/Organization.js';
import { AppError } from '../lib/AppError.js';
import { CreateOrganizationInput, UpdateOrganizationInput } from '../validators/organizationValidators.js';

// CONCEPT: layered architecture (see BACKEND_PRACTICES.md and
// env-config-and-folder-structure concept). This service is the ONLY
// place in the app that queries the Organization collection directly —
// controllers never call Organization.find()/create() themselves, they
// always go through a function here. That means if tenant-scoping logic
// or a future soft-delete filter ever needs to change, it changes in
// exactly one place, not in every controller that happens to touch
// Organization.

// FLOW: called by organizationController.createOrganization, itself
// wrapped in catchAsync, itself called after createOrganizationSchema
// has already validated the request body — so `input` here is already
// known to be well-formed.
export async function create(ownerId: string, input: { name: string; slug: string }) {
  const existing = await Organization.findOne({ slug: input.slug });
  if (existing) {
    throw new AppError(409, 'That organization slug is already taken');
  }

  const organization = await Organization.create({
    name: input.name,
    slug: input.slug,
    ownerId,
  });

  return organization;
}

// FLOW: called by organizationController.getOrganization, AFTER
// scopeToTenant has already confirmed tenantId matches the requested
// :orgId — so by the time this function runs, we already know the
// requester is allowed to see this organization. This function's job is
// purely to fetch the data, not to re-check authorization.
export async function findById(tenantId: string) {
  const organization = await Organization.findById(tenantId);
  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }
  return organization;
}

export async function update(tenantId: string, input: UpdateOrganizationInput) {
  const organization = await Organization.findByIdAndUpdate(
    tenantId,
    { $set: input },
    { new: true, runValidators: true } // return the updated doc; re-run schema validation on update
  );

  if (!organization) {
    throw new AppError(404, 'Organization not found');
  }

  return organization;
}