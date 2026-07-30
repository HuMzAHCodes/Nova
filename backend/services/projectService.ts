import Project from '../models/Project.js';
import { AppError } from '../lib/AppError.js';
import { CreateProjectInput, UpdateProjectInput, PROJECT_ALLOWED_SORT_FIELDS } from '../validators/projectValidators.js';
import { PaginationQuery } from '../validators/paginationValidators.js';

// CONCEPT: tenant-scoped queries (see multi-tenancy-and-architecture and
// tenant-scoping-middleware concepts). Every function here takes tenantId
// as an explicit, required parameter and uses it as a MongoDB filter —
// this function can never accidentally return another organization's
// projects, because it's structurally impossible to call it without
// supplying which tenant to scope to.

export async function create(tenantId: string, input: CreateProjectInput) {
  const project = await Project.create({
    organizationId: tenantId,
    name: input.name,
  });
  return project;
}

export async function findById(tenantId: string, projectId: string) {
  // Filtering by BOTH _id and organizationId in the same query means a
  // request for a real project ID that belongs to a DIFFERENT org
  // returns null (treated as "not found") rather than leaking that the
  // project exists at all under someone else's tenant.
  const project = await Project.findOne({ _id: projectId, organizationId: tenantId });
  if (!project) {
    throw new AppError(404, 'Project not found');
  }
  return project;
}

// CONCEPT: pagination/filtering/sorting (see rest-crud-design concept).
// FLOW: called by projectController.listProjects, AFTER the controller
// has already validated req.query against paginationQuerySchema — so
// `query` here is already a well-formed { page, limit, sort } object,
// not raw, unvalidated query-string values.
export async function listForTenant(tenantId: string, query: PaginationQuery) {
  const { page, limit, sort } = query;
  const skip = (page - 1) * limit;

  // Parse the sort param (e.g. "-createdAt" or "name") into a Mongoose
  // sort object, but ONLY if the requested field is in our explicit
  // allow-list — otherwise fall back to a safe default. This is the
  // fix for common mistake #6 in the rest-crud-design notes: never pass
  // a raw, client-supplied string directly into .sort().
  let sortObj: Record<string, 1 | -1> = { createdAt: -1 }; // safe default
  if (sort) {
    const direction: 1 | -1 = sort.startsWith('-') ? -1 : 1;
    const field = sort.replace(/^-/, '');
    if ((PROJECT_ALLOWED_SORT_FIELDS as readonly string[]).includes(field)) {
      sortObj = { [field]: direction };
    }
  }

  const [projects, total] = await Promise.all([
    Project.find({ organizationId: tenantId })
      .sort(sortObj)
      .skip(skip)
      .limit(limit),
    Project.countDocuments({ organizationId: tenantId }),
  ]);

  return {
    projects,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function update(tenantId: string, projectId: string, input: UpdateProjectInput) {
  const project = await Project.findOneAndUpdate(
    { _id: projectId, organizationId: tenantId }, // same tenant-safe filter as findById
    { $set: input },
    { new: true, runValidators: true }
  );

  if (!project) {
    throw new AppError(404, 'Project not found');
  }

  return project;
}

export async function remove(tenantId: string, projectId: string) {
  const project = await Project.findOneAndDelete({ _id: projectId, organizationId: tenantId });
  if (!project) {
    throw new AppError(404, 'Project not found');
  }
}