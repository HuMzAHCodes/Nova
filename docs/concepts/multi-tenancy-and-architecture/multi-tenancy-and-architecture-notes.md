# Notes: Multi-Tenancy & Backend Architecture Choice

This is the deep-dive companion to `multi-tenancy-and-architecture.md`. Where that file is the quick-reference version, this one is meant to be read when the concept feels shaky — full explanation, examples, and edge cases.

## Definition
**Multi-tenancy** is a software architecture pattern in which a single instance of an application — one deployed codebase, one running set of servers — serves multiple separate customers ("tenants"), while keeping each tenant's data logically isolated from every other tenant's, even though they may share the same underlying infrastructure (same servers, same database, sometimes even the same database tables/collections). A "tenant" is whichever unit the business treats as one customer — in a B2B SaaS product like Nova, that unit is an **Organization**, not an individual user, since many users (Owner, Admins, Members, Clients) belong to one paying customer.

This is distinct from **single-tenancy**, where each customer gets their own fully separate deployment (own server, own database, sometimes own codebase version) — the traditional "on-premise software" model. Multi-tenancy exists because single-tenancy doesn't scale operationally or economically once you have more than a handful of customers: you can't reasonably run and maintain hundreds of separate deployments by hand.

## Generalization — this isn't just a Nova-specific pattern
Multi-tenancy is a standard, load-bearing concept in essentially every B2B SaaS product that exists — not something invented for this project. Any time you sign into a shared web app on behalf of a company (Slack, Notion, Linear, Salesforce, GitHub organizations, Jira), you're a user inside a tenant, and the same core problem applies: the vendor runs one system for every customer, and must guarantee customers can never see each other's data. The three implementation strategies covered below (database-per-tenant, schema-per-tenant, shared-collection-with-tenant-ID) are the three approaches you'll see discussed in virtually any system-design conversation about SaaS architecture, regardless of the specific tech stack — this concept transfers directly to any backend job touching a multi-customer product, not just a MERN-specific trick.

The general engineering principle underneath all of it, stated abstractly: **whenever one system serves multiple independent parties who must not see each other's data, isolation has to be enforced at the layer that's hardest to accidentally bypass.** Sometimes that's infrastructure (separate databases). Sometimes — as in Nova's case — it's a deliberately-designed, hard-to-forget piece of application logic (a shared scoping middleware). The specific mechanism changes; the underlying question — "where does isolation actually get enforced, and how easy is it to bypass by mistake?" — is the one to always ask, in any system, not just this one.

## What "tenant" actually means here
In Nova, a "tenant" is one Organization. Every Organization has its own Users, Projects, Tasks, and (eventually) Clients scoped to specific projects. The entire point of multi-tenancy is: even though all of this data sits in the *same* MongoDB cluster and the *same* collections, no request from Organization A should ever be able to read, modify, or even infer the existence of Organization B's data.

## Walking through the three approaches with a concrete example
Imagine two agencies sign up: "PixelCraft" and "DevForge."

**Option 1 — database per tenant.** PixelCraft's data lives in a MongoDB database called `pixelcraft_db`, DevForge's in `devforge_db`. Total isolation — a bug in your query logic literally *can't* leak data between them, because they're not even in the same database connection. But: every new signup means provisioning a new database, running migrations against it, and monitoring it separately. At 2 tenants this is fine. At 200, it's an operational nightmare, and free-tier MongoDB Atlas doesn't make spinning up unlimited databases painless either.

**Option 2 — shared database, separate collections per tenant.** You'd have `pixelcraft_projects`, `devforge_projects`, etc. Slightly less overhead than option 1, but you still need per-tenant provisioning logic (creating new collections dynamically), and now schema migrations have to run against N collections instead of 1.

**Option 3 — our choice — one `projects` collection, every document has `organizationId`.** PixelCraft's projects and DevForge's projects sit in the exact same collection, distinguished only by the value of `organizationId`. No provisioning step needed for a new tenant — a new Organization document is just... a new document. The tradeoff: isolation now lives entirely in *application logic*, not infrastructure. If a query forgets to filter by `organizationId`, it will return both PixelCraft's and DevForge's data mixed together. That's the real risk this pattern introduces, and why the *scoping mechanism* matters so much (see below).

## The scoping mechanism, explained with an example
Say a Manager at PixelCraft requests `GET /api/projects` to see their project list. Naively, a developer might write:
```js
// DANGEROUS — no tenant filter
const projects = await Project.find({});
```
This would return every project from every organization in the whole system — a total data leak. The fix isn't "remember to add organizationId every time" (humans forget), it's to make forgetting structurally impossible. A middleware reads the authenticated user's `organizationId` (from their JWT) and attaches it to the request; a query helper then requires that value to build any tenant-scoped query:
```js
// req.tenantId set by middleware, from the authenticated user's token
const projects = await Project.find({ organizationId: req.tenantId });
```
Better still, a shared repository/service function wraps this so individual controllers never write raw `Project.find()` calls directly — they call something like `projectService.listForTenant(req.tenantId)`, and the tenant filter is baked into that one function, not repeated (and potentially forgotten) across every controller that touches projects.

## Why `organizationId` is denormalized onto Task — a concrete scenario
Suppose Task didn't carry `organizationId` directly, and you always had to go `Task → Project → organizationId` to check tenant ownership. Now imagine a bug where a Task's `projectId` gets corrupted or a migration script accidentally reassigns a batch of tasks to the wrong Project. If Task's own `organizationId` field didn't exist, this bug could silently move data across tenant boundaries — nothing else would catch it, because your only tenant-check ran *through* the very relationship that broke. With `organizationId` directly on Task, that field acts as an independent check: even if the Project link were wrong, a scoped Task query still wouldn't leak into another tenant's view, because it's filtering on a separately-stored value.

## Client role — worked example
Consider "PixelCraft" invites their client "Acme Corp" to view progress on the "Acme Website Redesign" project only — not PixelCraft's other five ongoing projects for other clients. This is why Client access can't just be "org-level role = Client" — that alone would need to imply *which* projects. Instead, we need something like a `ClientAccess` mapping: `{ userId: <Acme contact>, organizationId: <PixelCraft>, projectId: <Acme Website Redesign> }`. When Acme's contact logs in and requests project data, the permission check becomes: (1) does a ClientAccess record exist matching this user, this org, and this specific project, and (2) is the action being attempted one Clients are allowed to do (view, approve — never edit tasks or org settings). Both checks have to pass. If PixelCraft later invites Acme to a second project, that's a second ClientAccess record — Acme's access is additive and explicit, never assumed by role alone.

## A common misconception worth flagging
It's tempting to think "RBAC" (Owner/Admin/Member roles) and "multi-tenancy" (organizationId scoping) are the same mechanism. They're not — they answer different questions. Multi-tenancy answers "which organization does this data belong to." RBAC answers "given that you're in this organization, what are you allowed to do." Nova needs both, layered: first confirm tenant ownership, then check role-based permission, then — for Clients specifically — check the additional project-level scope. Conflating these into a single check is a common design mistake that gets harder to untangle as the app grows.
