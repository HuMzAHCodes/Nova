import { Response, NextFunction } from 'express';
import { TenantScopedRequest } from './scopeToTenant.js';
import ClientAccess from '../models/ClientAccess.js';

// Extends the already-extended request further, adding clientPermissions —
// only ever set when the requester is actually a Client.
export interface ClientScopedRequest extends TenantScopedRequest {
  // "extends TenantScopedRequest" chains the extension: this interface has
  // everything Request had, PLUS tenantId/userRole/user, PLUS the field below.
  clientPermissions?: string[];
  // an array of permission strings, e.g. ['view_invoices', 'upload_files']
}

// Layer 2 — only applied on routes reachable by the client portal.
// If the requester isn't a Client, this is a no-op: internal roles proceed
// using their normal org-level / per-project role logic instead, which
// lives elsewhere (not in this middleware).
//
// Must run AFTER scopeToTenant, since it relies on req.tenantId and
// req.userRole already being set.
export async function scopeToClientProject(
  
  req: ClientScopedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
 
  if (req.userRole !== 'client') {
    next();
    // early exit for non-client roles — just pass through untouched.
    return;
  }

  const projectId = req.params.projectId;
  // req.params comes from the URL itself, e.g. /projects/:projectId/files
  // → so req.params.projectId is whatever value sits in that URL segment.

  if (!projectId) {
    res.status(400).json({ success: false, error: 'Missing projectId' });
    return;
  }

  // This is the one place a real database query happens in this middleware —
  // unlike scopeToTenant, which only reads data already present on the
  // request. See the concept notes for why this async/sync distinction
  // is meaningful, not incidental.
  const access = await ClientAccess.findOne({
    // "await" pauses this function (without blocking the whole server)
    // until the database query resolves — that's why the function had
    // to be declared "async" in the first place.
    userId: req.user?._id,
    organizationId: req.tenantId,
    projectId,
    // shorthand for "projectId: projectId" — ES6 object property shorthand.
  });

  if (!access) {
    res.status(403).json({ success: false, error: 'No access to this project' });
    // 403 = "Forbidden" — the requester is authenticated, just not allowed
    // access to this specific project (different from 401 = "not authenticated").
    return;
  }

  req.clientPermissions = access.permissions;
  next();
}