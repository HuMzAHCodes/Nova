import { Response, NextFunction } from 'express';
import { TenantScopedRequest } from './scopeToTenant.js';

// CONCEPT: RBAC middleware (see docs/concepts/rbac-middleware). This is a
// middleware FACTORY, not a plain middleware — it's called with the
// allowed roles at ROUTE DEFINITION time (e.g. requireRole('owner', 'admin')
// in a routes file), and returns the actual (req, res, next) function
// Express calls at REQUEST time. This is the standard pattern for any
// middleware that needs to be "configured" per-route, since Express
// middleware always has the same fixed (req, res, next) signature —
// there's no other way to pass in which roles a specific route allows.
//
// FLOW: must run AFTER scopeToTenant, since it reads req.userRole, which
// scopeToTenant is what sets.
//
// Deliberately never include 'client' in an allowedRoles list — Client
// access goes through the separate scopeToClientProject middleware
// (built in Week 1) on the narrow set of client-portal routes, not
// through this general-purpose internal RBAC check.
export function requireRole(...allowedRoles: string[]) {
  return (req: TenantScopedRequest, res: Response, next: NextFunction): void => {
    if (!req.userRole || !allowedRoles.includes(req.userRole)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}