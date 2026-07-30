import { Request, Response, NextFunction } from 'express';

// Extends Express's Request type so every route that uses this middleware
// (and every controller/service downstream of it) knows tenantId and
// userRole exist on the request, with proper TypeScript typing.
export interface TenantScopedRequest extends Request {
  tenantId?: string;
  userRole?: string;
  user?: {
    _id: string;
    organizationId: string;
    role: string;
  };
}

// CONCEPT: tenant-scoping middleware, Layer 1 (see docs/concepts/
// tenant-scoping-middleware). Applies to every protected route.
//
// FLOW: this runs before any controller. It does two things, in order:
//   1. Confirms the request is authenticated at all (req.user exists).
//   2. If the route's URL includes an :orgId param (e.g.
//      /api/organizations/:orgId/projects), confirms it matches the
//      authenticated user's ACTUAL organization from their JWT — not
//      just that they're logged in as *someone*. Without this second
//      check, an authenticated user from Org A could view Org B's data
//      simply by editing the URL. See docs/concepts/rest-crud-design
//      for why this check lives here (a synchronous comparison) rather
//      than in its own separate middleware the way the async
//      Client-access check does.
//
// NOTE: req.user is a placeholder until real JWT auth exists (Week 2).
// Once auth middleware runs before this one, it will populate req.user
// from the decoded, signed JWT payload.
export function scopeToTenant(req: TenantScopedRequest, res: Response, next: NextFunction): void {
  const organizationId = req.user?.organizationId;

  if (!organizationId) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    return;
  }

  // Only applies on routes that actually have :orgId in their path —
  // routes without it (e.g. /api/projects/:id) skip this check, since
  // there's nothing in the URL to cross-verify against yet.
  if (req.params.orgId && req.params.orgId !== organizationId) {
    res.status(403).json({ success: false, error: 'Not authorized for this organization' });
    return;
  }

  req.tenantId = organizationId;
  req.userRole = req.user?.role;
  next();
}