import { Response, NextFunction } from 'express';
import { TenantScopedRequest } from './scopeToTenant.js';
import User from '../models/User.js';

// CONCEPT: RBAC middleware (see docs/concepts/rbac-middleware). Like
// requireRole, this is a middleware factory — but it also needs to check
// per-project role OVERRIDES (the projectRoles array built into the User
// model in Week 1), not just the flat org-level role, since a user like
// Aisha (member org-wide) might be elevated to 'manager' on ONE specific
// project without her org-level role changing at all.
//
// FLOW: must run AFTER scopeToTenant. Requires the route to have a
// :projectId param — used to check whether any override applies to THIS
// specific project.
export function requireProjectRole(...allowedRoles: string[]) {
  return async (req: TenantScopedRequest, res: Response, next: NextFunction): Promise<void> => {
    // FAST PATH: if the user's org-level role already satisfies the
    // requirement, skip the database lookup entirely. This matters
    // because most requests never involve a per-project override —
    // checking the cheap, already-available value first avoids an
    // unnecessary query on the common case (see concept notes for the
    // worked PixelCraft example showing why this ordering matters).
    if (req.userRole && allowedRoles.includes(req.userRole)) {
      next();
      return;
    }

    // SLOW PATH: org-level role wasn't sufficient — check for a
    // per-project override matching BOTH this specific project AND an
    // allowed role. Checking only the role without also matching
    // projectId would incorrectly grant access to every project a user
    // has ANY override on, not just the one being requested.
    const projectId = req.params.projectId;
    if (!projectId) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' });
      return;
    }

    const user = await User.findById(req.user?._id);
    const hasOverride = user?.projectRoles.some(
      (pr) => pr.projectId.toString() === projectId && allowedRoles.includes(pr.role)
    );

    if (!hasOverride) {
      res.status(403).json({ success: false, error: 'Insufficient permissions for this project' });
      return;
    }

    next();
  };
}