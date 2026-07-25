# Concept: Multi-Tenancy & Backend Architecture Choice

## What this concept is
Multi-tenancy is the pattern where one shared database and one shared codebase serve many independent organizations ("tenants") — in Nova's case, every agency that signs up. The core requirement: Org A must never be able to see or touch Org B's projects, tasks, or clients, even by accident.

## The problem it solves
Without a deliberate multi-tenancy strategy, a SaaS app either (a) needs a new database spun up per customer — expensive and operationally heavy — or (b) risks data leaking between tenants because scoping logic is scattered and inconsistent across the codebase. Nova needs an approach that's cheap (fits our $0 hosting requirement), simple to reason about, and hard to get wrong by accident.

## The three real options (and why we picked one)
1. **Separate database per tenant** — maximum isolation, but heavy to provision/scale. Realistic for large enterprise customers, not for an early-stage or portfolio SaaS.
2. **Separate schema/collection per tenant** — a middle ground, still becomes unwieldy to manage as tenant count grows.
3. **Shared database, shared collections, `organizationId` on every tenant-scoped document** — one `organizations`, `users`, `projects`, `tasks` collection each, with every document tagged by which org it belongs to.

**Chosen: option 3.** This is the standard early-stage SaaS pattern (Slack, Notion, Linear all started this way), it runs entirely on a single free-tier MongoDB Atlas cluster, and — most importantly — it forces us to solve the *real* hard problem in multi-tenancy: guaranteeing no query ever runs without a tenant filter. That's solved with a shared, reusable scoping mechanism (a middleware/query-helper that injects `organizationId` automatically) rather than trusting every route to remember it manually.

## What we implemented (data model)
```
Organization (tenant root)
   └── User (organizationId + org-level role: Owner/Admin/Member/Client)
         └── Project (organizationId + per-project role overrides)
               └── Task (organizationId + projectId)
```

**Deliberate denormalization:** `Task` carries `organizationId` directly, even though it's derivable via `Task → Project → Organization`. Tradeoff: slightly more duplicated data, in exchange for (a) faster queries — no join/populate needed to filter "all of Org A's tasks" — and (b) defense-in-depth: a tenant-scoped query never accidentally crosses tenants even if the Task→Project relationship logic has a bug elsewhere.

## Where the Client role complicates this (the interesting part)
Most multi-tenancy examples stop at "scope everything by organizationId." Nova's Client role adds a second layer: a Client doesn't belong to the whole organization — they're scoped to *specific projects* within it, and even within those projects they only get read/approve permissions, never write access to tasks or org settings. So permission resolution for a Client isn't a single check ("is this your org") — it's two: **(1) is this your organization, and (2) if you're a Client, are you specifically scoped to this project, and is the action you're attempting one a Client is allowed to take.** This is a more advanced RBAC-within-multi-tenancy pattern than a typical portfolio project attempts, and it's directly tied to Nova's differentiator (see PITCH.md, DECISIONS.md).

## Architecture choice: layered-by-concern, feature-grouped internally
We chose the layered backend structure already defined in `BACKEND_PRACTICES.md` (routes/controllers/services/models/middleware/lib/hooks/validators) over a flat classic-MVC layout, specifically because of multi-tenancy: tenant-scoping is a cross-cutting concern that touches almost every feature (auth, projects, tasks, billing, client-portal). A shared `middleware/scopeToTenant.js` that every route pulls in enforces the scoping *by construction* — a feature-scattered MVC layout makes that same guarantee much easier to accidentally break.

## Likely interview questions on this concept (with answers)

**Q: How do you prevent data leakage between tenants in a shared-collection multi-tenancy model?**
A: Never trust individual routes to remember tenant scoping manually. Instead, enforce it structurally — a shared middleware/query-helper reads the authenticated user's `organizationId` and injects it into every query automatically, so a developer would have to actively bypass the helper to introduce a leak, rather than simply forgetting a `where` clause. Pair this with tests specifically asserting that a request from one org can never read another org's documents.

**Q: What are the tradeoffs between database-per-tenant, schema-per-tenant, and shared-collection approaches?**
A: Database-per-tenant gives the strongest isolation and the easiest "delete everything for this customer" story, but is operationally expensive — provisioning, backups, and migrations all multiply per tenant, which doesn't fit a free-tier, low-tenant-count project. Schema-per-tenant is a middle ground — some isolation benefit, but still requires per-tenant provisioning logic and doesn't meaningfully reduce the operational burden versus separate databases. Shared collections with a tenant ID column is the cheapest and simplest to run at small-to-medium scale, at the cost of needing rigorous, structurally-enforced query scoping — the isolation lives in application logic rather than the infrastructure layer.

**Q: Why denormalize `organizationId` onto `Task` instead of deriving it through `Project`?**
A: Two reasons. Performance: filtering "all tasks in this org" becomes a direct indexed query instead of a join/populate through Project. Safety: it's defense-in-depth — even if a bug elsewhere mis-associates a Task with the wrong Project, the Task's own `organizationId` field is still an independent, directly-checkable guard, so tenant isolation doesn't depend on a single relationship being correct.

**Q: How would you design permission scoping for a role that isn't organization-wide but project-specific (the Client role)?**
A: Model it as two independent checks rather than one. First, the standard tenant check (does this resource belong to the requester's organization at all). Second, a project-level scope check specific to the Client role (is this Client explicitly granted access to this particular project, via a mapping like a `ClientAccess` join, not just "any member of the org"). On top of that, apply an action-level restriction — even where a Client is scoped to a project, their allowed actions are narrower than an internal role's (read/approve only, never write to tasks or settings). Keeping these as separate, composable checks — rather than one combined role-check — makes it straightforward to add other narrowly-scoped external roles later without reworking the whole permission system.

**Q: Why does architecture choice matter for enforcing a cross-cutting concern like tenant isolation?**
A: Because tenant scoping needs to be applied consistently across almost every feature — auth, projects, tasks, billing, client-portal — a layered structure lets that concern live in one shared, reusable place (a middleware every route pulls in) instead of being reimplemented per feature. In a flat, feature-scattered MVC layout, each feature module is more likely to reinvent its own scoping logic slightly differently, which is exactly how leaks happen — the architecture choice is what makes "secure by construction" actually achievable rather than aspirational.
