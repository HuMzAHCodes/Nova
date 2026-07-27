import { Request, Response, NextFunction } from 'express';

// NextFunction = a callback you call to pass control to the *next* middleware/route
//                handler in the chain. If you don't call it, the request hangs forever.

// Extends Express's Request type so every route that uses this middleware
// (and every controller/service downstream of it) knows tenantId and
// userRole exist on the request, with proper TypeScript typing.
export interface TenantScopedRequest extends Request {
  // "extends Request" means: TenantScopedRequest has everything Request has,
  // PLUS the extra fields defined below.
  tenantId?: string;
 
  userRole?: string;
  user?: {
    _id: string;
    organizationId: string;
    role: string;
  };
  // this is an inline object type — normally you'd import a shared
  // User type instead of redefining its shape here.
}

// Layer 1 — applies to every protected route. Confirms which organization
// this request is allowed to act on behalf of, and attaches it as
// req.tenantId so every downstream controller/service reads from here —
// never from req.body or req.query, which would be attacker-controlled.
//
// NOTE: req.user is a placeholder until real JWT auth exists (Week 2).
// Once auth middleware runs before this one, it will populate req.user
// from the decoded, signed JWT payload. For now this middleware assumes
// req.user is already set by something upstream.
export function scopeToTenant(req: TenantScopedRequest, res: Response, next: NextFunction): void {
  // ": void" means this function doesn't return a value — it either
  // calls next() or sends a response, never both.

  const organizationId = req.user?.organizationId;
  // "?." is optional chaining — if req.user is undefined, this whole
  // expression evaluates to undefined instead of throwing an error.

  if (!organizationId) {
    res.status(401).json({ success: false, error: 'Not authenticated' });
    // "return" here just exits the function early — it does NOT return
    // a value (matches the ": void" above). Without this, execution
    // would fall through and call next() even after sending a response.
    return;
  }

  req.tenantId = organizationId;
  req.userRole = req.user?.role;

  next();
  // hands off control to whatever route handler/middleware comes next
  // in the chain for this request.
}