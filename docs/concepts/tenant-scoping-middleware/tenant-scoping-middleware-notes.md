# Notes: Tenant-Scoping Middleware (Two-Layer)

Deep-dive companion to `tenant-scoping-middleware.md`.

## Definition
**Middleware**, in the Express sense, is a function that runs between a request arriving and its final controller handling it — it can inspect or modify the request, reject it early, or pass it along to the next piece of middleware (or the controller) in the chain. **Tenant-scoping middleware** specifically is middleware whose entire job is to establish, before any business logic runs, which tenant (Organization) the current request is allowed to act on behalf of.

## Generalization
This pattern — a shared, mandatory piece of request-handling logic that every relevant route passes through — is one of the most common and important patterns in any multi-tenant backend, in any framework. Django calls this a "middleware" too; Rails might implement it as a `before_action` filter; ASP.NET Core calls it "middleware" as well. The name and mechanics vary slightly by framework, but the underlying idea — enforce a cross-cutting concern once, centrally, rather than trusting every handler to remember it — applies universally to authentication, authorization, logging, rate limiting, and tenant isolation alike.

## Walking through the request flow with code

**Layer 1 — `scopeToTenant`:**
```ts
// middleware/scopeToTenant.ts
import { Request, Response, NextFunction } from 'express';

// Extends Express's Request type so TypeScript knows req.tenantId exists
// on any request that's passed through this middleware.
export interface TenantScopedRequest extends Request {
  tenantId?: string;
  userRole?: string;
}

export function scopeToTenant(req: TenantScopedRequest, res: Response, next: NextFunction) {
  // In Week 2, this will read from the decoded JWT payload attached by
  // an earlier auth middleware (e.g. req.user.organizationId). For now,
  // this is a stub showing the shape of what will happen.
  const organizationId = req.user?.organizationId; // placeholder until auth exists

  if (!organizationId) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }

  req.tenantId = organizationId;
  req.userRole = req.user?.role;
  next();
}
```

**Layer 2 — `scopeToClientProject`:**
```ts
// middleware/scopeToClientProject.ts
import { Response, NextFunction } from 'express';
import { TenantScopedRequest } from './scopeToTenant.js';
import ClientAccess from '../models/ClientAccess.js';

export async function scopeToClientProject(req: TenantScopedRequest, res: Response, next: NextFunction) {
  // If the requester isn't a Client, this middleware has nothing to do —
  // internal roles proceed using their normal role-based checks instead.
  if (req.userRole !== 'client') {
    return next();
  }

  const projectId = req.params.projectId; // assuming the route includes this
  const access = await ClientAccess.findOne({
    userId: req.user?._id,
    organizationId: req.tenantId,
    projectId,
  });

  if (!access) {
    // A Client with no matching ClientAccess record for this project
    // gets rejected here — before the controller ever runs.
    return res.status(403).json({ success: false, error: 'No access to this project' });
  }

  (req as any).clientPermissions = access.permissions;
  next();
}
```

**How these get applied to routes:**
```ts
// An internal-only route — only needs Layer 1
router.get('/organizations/:orgId/billing', scopeToTenant, getBillingInfo);

// A route reachable by both internal roles and Clients — needs both layers
router.get('/projects/:projectId', scopeToTenant, scopeToClientProject, getProjectDetails);
```

## Why the Client check has to be async (a real implementation detail)
Notice `scopeToClientProject` is declared `async` and awaits a database query (`ClientAccess.findOne(...)`), while `scopeToTenant` is synchronous. This is a genuine, meaningful difference: `scopeToTenant` only reads data already present on the request (the decoded JWT payload attached by an earlier middleware) — no database round-trip needed. `scopeToClientProject`, however, has to check a completely separate collection (`ClientAccess`) to determine whether this specific Client has been granted access to this specific project — that requires an actual query, which is inherently asynchronous. This is a small but real illustration of a broader principle: authorization checks that only interpret already-available data (like a JWT payload) are cheap and synchronous; checks that need to consult additional state (like a database) are inherently more expensive and asynchronous, and should be scoped as narrowly as possible (applied only where genuinely needed) rather than run on every single request regardless of whether it's relevant.

## A subtlety: why `scopeToTenant` doesn't reject a Client outright
It might seem like `scopeToTenant` should immediately reject any Client, since Clients aren't "real" organization members the way internal roles are. But `scopeToTenant`'s job is narrowly just "confirm which organization this request claims to belong to and record it" — it deliberately doesn't make role-based access decisions at all. That responsibility belongs entirely to `scopeToClientProject` (for Clients) or other role-checking logic (for internal roles). Keeping `scopeToTenant` role-agnostic means it can be the one universal, unconditionally-applied piece of middleware across the entire app, while all the actual "who's allowed to do what" logic lives in more specific, purpose-built middleware layered on top — exactly the separation of concerns this two-layer design is built around.

## Common failure mode this design prevents
Imagine, without this structure, a developer builds a new endpoint quickly and writes:
```ts
// DANGEROUS — trusts a client-supplied organizationId
const projects = await Project.find({ organizationId: req.body.organizationId });
```
This is a realistic mistake under time pressure — it "works" in casual testing (since a legitimate request would naturally include the correct `organizationId`), but it's a serious vulnerability, since nothing stops a malicious request from simply supplying a different organization's ID in the body. With `scopeToTenant` already attaching a trustworthy `req.tenantId` derived from the signed JWT, the correct, safe pattern becomes the *easier* one to write (`req.tenantId` is already right there, no need to reach into `req.body` at all) — which is exactly the goal: making the safe path the path of least resistance, not just a rule developers have to remember to follow.