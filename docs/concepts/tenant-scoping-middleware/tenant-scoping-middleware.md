# Concept: Tenant-Scoping Middleware (Two-Layer)

## What this concept is
The actual enforcement mechanism for the multi-tenancy guarantee designed in the earlier multi-tenancy concept: a base `scopeToTenant` middleware that attaches the authenticated user's `organizationId` to every request, plus a separate `scopeToClientProject` middleware that additionally resolves a Client's narrower, project-specific access — applied only on the routes Clients are allowed to reach.

## The problem it solves
Designing the data model (Concept 1) established *that* every tenant-scoped query needs an `organizationId` filter, and that a Client needs an additional, narrower project-level check. But a design on paper doesn't stop a developer from writing `Project.find({})` in a controller and forgetting the filter. This concept turns that design into something the code structurally enforces, rather than something that depends on every developer remembering it correctly every time.

## What we implemented

### Layer 1 — `scopeToTenant` (applies to every protected route)
Reads the authenticated user's `organizationId` (from the JWT payload, once auth exists in Week 2) and attaches it to the request as `req.tenantId`. Every controller that touches a tenant-scoped model reads `req.tenantId` from here — never re-derives it, never trusts a client-supplied `organizationId` from the request body or query string (which would let a malicious request simply claim to belong to a different organization).

### Layer 2 — `scopeToClientProject` (applies only to routes exposed to the client portal)
Only added on routes that Clients can reach at all. Checks the requester's role: if they're a Client, resolves their `ClientAccess` record(s) for the requested project and attaches the allowed `permissions` to the request (e.g., `req.clientPermissions`). If the requester isn't a Client, this middleware is a no-op — internal roles proceed using their normal org-level/per-project role logic instead.

## Why two separate middlewares instead of one combined one
Combining both checks into a single middleware would mean every route — including ones Clients should never be able to reach at all — carries the mental and runtime overhead of client-scoping logic. Keeping them separate means: routes only for internal roles (e.g., billing settings, org member management) only need `scopeToTenant` and never have to reason about Client logic at all. Routes that are part of the client portal (Week 4) explicitly opt into the second layer. This mirrors the two-step permission check described conceptually in the multi-tenancy design doc — tenant check, then role-specific check — as two separate, composable pieces of code instead of one function trying to do both jobs.

## Likely interview questions on this concept (with answers)

**Q: Why read `organizationId` from the JWT instead of from the request body or query parameters?**
A: A request body or query parameter is fully controlled by whoever sends the request — if a client-supplied `organizationId` were trusted, an attacker could simply claim to belong to a different organization and access its data. The JWT is signed server-side at login time and can't be forged without the server's secret, so it's the only trustworthy source for "which organization does this authenticated request actually belong to."

**Q: What's the benefit of centralizing this in middleware rather than checking it inside each controller?**
A: Middleware guarantees the check runs before the controller's own logic executes at all, and it only needs to be written once. If tenant-scoping logic were duplicated inside every controller, a single missed or slightly-different implementation in one controller would create a real data leak — centralizing it in middleware makes "every protected route is tenant-scoped" a property of the routing setup itself, not something that depends on every controller author remembering correctly.

**Q: Why does the Client-scoping check live in a separate middleware instead of being folded into `scopeToTenant`?**
A: Because it's a fundamentally different, narrower kind of check that only applies to a subset of routes and a subset of users. Folding it into the base middleware would force every route — even ones a Client could never legitimately reach — to carry that extra logic and reasoning. Separating it means the client-specific complexity is opt-in, scoped only to the routes that actually need it (the client portal), keeping the base tenant check simple and universally applicable.

**Q: What would happen if a Client tried to hit a route that only has `scopeToTenant` applied, with no `scopeToClientProject`?**
A: `scopeToTenant` alone doesn't grant any role-specific permissions — it only establishes which organization the request belongs to. A route without the second middleware (or without its own role check) still needs some authorization check to reject a Client's request appropriately; simply not having Client-specific logic doesn't automatically grant a Client access. This is exactly why route-level tests for "a Client attempting to hit an internal-only route" are called out explicitly in the roadmap's Week 8 seam-case testing — it's a real, easy-to-miss edge case.