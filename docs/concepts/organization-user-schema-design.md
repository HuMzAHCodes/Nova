# Concept: Organization, User & ClientAccess Schema Design

## What this concept is
The concrete Mongoose schema design implementing the multi-tenancy model designed earlier: an `Organization` collection as the tenant root, a `User` collection scoped to one organization each, and a separate `ClientAccess` collection modeling the Client role's project-specific, external-facing permissions.

## The problem it solves
The earlier multi-tenancy concept established *that* every tenant-scoped document needs an `organizationId`, and that the Client role needs project-level scoping distinct from internal roles. This concept turns that design into actual schema decisions — specifically, deciding how to represent two genuinely different kinds of "access to a project": an internal teammate's elevated per-project role, and an external client's fundamentally narrower, read-mostly grant.

## What we implemented

### Organization
- `name` — display name
- `slug` — unique, URL-safe identifier, added now even though unused immediately, since retrofitting a unique slug onto existing records later is painful
- `ownerId` — reference to the owning User, for fast lookups without querying all users by role
- `subscriptionTier` — `free` / `pro` / `business`, belongs on Organization since billing is org-level
- Mongoose timestamps

### User
- `email`, `passwordHash`, `name` — auth basics
- `organizationId` — required, the core of the multi-tenancy scoping
- `role` — org-level enum: `owner` / `admin` / `member` / `client`
- `projectRoles` — array of `{ projectId, role }`, supporting per-project role overrides for internal roles (e.g., a Member elevated to Manager on one project)

### ClientAccess (separate collection, not folded into User's `projectRoles`)
- `userId` — the Client user
- `organizationId` — which org they're a client of
- `projectId` — which specific project they're scoped to
- `permissions` — the narrow, fixed set a Client gets (view, approve) — deliberately not an open-ended role string like internal roles use

## Why a separate `ClientAccess` collection instead of reusing `projectRoles`

Two options were considered: folding Client scoping into the same `projectRoles` array already used for internal per-project overrides, or a dedicated collection. We chose the dedicated collection because internal per-project overrides and external client access are conceptually different things being forced into the same shape would obscure: an internal override *elevates* an existing team member's permissions within the org they already belong to, while a Client access grant *creates* access from outside the organization's normal membership, with a fundamentally narrower and fixed permission set. Modeling them identically would make both harder to reason about — a query for "all internal per-project overrides" would need to filter out clients and vice versa, and any future difference in how these two concepts evolve (e.g., adding audit fields specific to client approvals) would be awkward to represent in a shared array.

## Likely interview questions on this concept (with answers)

**Q: Why does `User` store both an org-level `role` and a `projectRoles` array, instead of just per-project roles everywhere?**
A: Most permission checks in the app are org-wide (can this user see the organization's billing page, invite members, etc.) and only need the simple org-level role — computing that from a per-project array every time would be unnecessary overhead and complexity for the common case. The `projectRoles` array exists specifically for the narrower case of a project-specific override, layered on top of the org-level role rather than replacing it.

**Q: Why is Client access modeled as a separate collection instead of just another entry in the User schema?**
A: Because it represents a different *kind* of relationship, not just a different role value. An internal per-project override still trusts the user with the organization at a base level (they have an org role, they're a normal member of the tenant). A Client's entire relationship to the organization is defined by which specific projects they're allowed into — there's no meaningful "org-level role" for a Client the way there is for an internal user. Separating the collections keeps that distinction structurally clear rather than papering over it with a shared array shape.

**Q: Why add a `slug` field to Organization now, if it's not used yet?**
A: Unique fields are far easier to add correctly at schema-design time than to retrofit later — once real organizations exist without slugs, generating and backfilling unique values for all of them, while handling collisions, becomes a migration problem. Reserving the field now costs nothing and avoids that future complexity, even though nothing consumes it until a later feature (e.g., a branded client-portal URL) actually needs it.

**Q: Why store `ownerId` on Organization when it's derivable by querying Users for `role: 'owner'`?**
A: Similar reasoning to the `organizationId` denormalization on Task in the multi-tenancy concept — it's a small amount of duplicated data in exchange for a much cheaper, more direct lookup ("who owns this org") that would otherwise require scanning or indexing Users by role and organization together. It also guards against an edge case: if ownership transfer logic has a bug that leaves two users both marked `role: 'owner'`, `ownerId` is still an unambiguous single source of truth for who the actual owner is.
