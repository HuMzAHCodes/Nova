# Notes: Organization, User & ClientAccess Schema Design

Deep-dive companion to `organization-user-schema-design.md`.

## Definition
**Schema design** in a document database like MongoDB is the process of deciding how data is shaped, grouped into collections, and related to other data — analogous to designing tables and foreign keys in a relational database, but with more flexibility (and more responsibility) since MongoDB doesn't enforce relationships or referential integrity by default. Every design choice here is a tradeoff the developer makes deliberately, not something the database enforces for you.

## Generalization
The core tension in this concept — "should two similar-looking things share one flexible schema, or get separate schemas because they're conceptually different" — is one of the most common modeling decisions in any backend system, regardless of database technology. It shows up as: one `users` table with a `type` column vs. separate `admins`/`customers` tables in SQL; one polymorphic model vs. several concrete models in an ORM; one generic `permissions` array vs. purpose-built access-control tables in any permission system. The general principle: **shared shape should reflect genuinely shared behavior, not just superficial similarity.** Two things that happen to both be "a role attached to a project" aren't necessarily the same *kind* of thing if they have different lifecycles, different owners of the data, or different rules governing them.

## Walking through the ClientAccess decision with a concrete scenario

Imagine "PixelCraft" (an agency, one Organization) has:
- 5 internal team members, each with an org-level role (`owner`, `admin`, a few `member`s)
- One of those members, Aisha, is elevated to `manager` specifically on the "Redesign" project via `projectRoles`
- Two external clients, "Acme Corp" (scoped to the "Redesign" project) and "Globex" (scoped to a different project, "Globex Rebrand")

**If Client access were folded into `projectRoles` on User:**
```js
// Acme's contact, modeled as a User
{
  email: 'contact@acme.com',
  organizationId: 'pixelcraft-id',  // is this even meaningful for a client?
  role: 'client',                    // org-level role — but a client isn't really "in" the org
  projectRoles: [
    { projectId: 'redesign-id', role: 'client' }
  ]
}
```
This is awkward in a specific way: giving a Client an `organizationId` at all implies they're a member of the organization the same way Aisha is — but they're not. They didn't join the org; they were granted narrow access to one project *within* it. The org-level `role: 'client'` field is also doing nothing useful here, since a Client's actual permissions come entirely from their (single) `projectRoles` entry, not from any org-wide role.

**With a separate `ClientAccess` collection:**
```js
// Aisha — a real internal User with a project override
{
  email: 'aisha@pixelcraft.com',
  organizationId: 'pixelcraft-id',
  role: 'member',
  projectRoles: [
    { projectId: 'redesign-id', role: 'manager' }
  ]
}

// Acme's contact — not a User with an org role at all, just an access grant
{
  userId: 'acme-contact-user-id',   // still needs a User record for login/auth
  organizationId: 'pixelcraft-id',
  projectId: 'redesign-id',
  permissions: ['view', 'approve']
}
```
Now the shapes reflect the actual relationships: Aisha's record says "I'm a real member of this org, with an extra elevated permission on one project." Acme's record says "I have a specific, narrow grant to see and approve on exactly one project — nothing about me implies I'm part of the organization at all."

## A subtlety: does a Client still need a `User` document?
Yes — even with `ClientAccess` as a separate collection, the Client still needs *some* `User` record to log in, since authentication (email/password, JWT issuance) operates on Users. The distinction is: that User's `organizationId` and `role` fields become largely irrelevant to what they can actually do — their real permissions come entirely from querying `ClientAccess` for their `userId`. This is a case where two collections work together: `User` handles "who can log in," `ClientAccess` handles "what can this specific login actually see and do." Keeping these separate concerns in separate collections, rather than trying to make one schema answer both questions, is a common and healthy pattern once a permission model gets this nuanced.

## Why permissions on ClientAccess is a fixed list, not an open role string
Internal roles (`owner`, `admin`, `member`) are open-ended in the sense that what each role can do might expand over time as the app grows — new features get gated by role checks against these same names. Client permissions are deliberately modeled differently: `permissions: ['view', 'approve']` is an explicit, enumerable list rather than a role name that implicitly grants a bundle of actions defined elsewhere in code. This is a deliberate design choice reflecting that Client capabilities should stay narrow and explicit — new features shouldn't accidentally become available to Clients just because someone forgot to exclude the `client` role from a new permission check elsewhere. An explicit allow-list is safer by default than a role name whose meaning could quietly expand.

## The `slug` field — a concrete example of why it's added early
Suppose 50 organizations sign up over a few months without a `slug` field. Later, a feature needs unique, URL-safe identifiers (e.g., `nova.app/pixelcraft/portal` for the client portal). Adding `slug` now means:
1. A migration script must generate a slug for all 50 existing orgs (typically by slugifying their `name`)
2. Collisions must be handled (`Pixel Craft` and `PixelCraft` might both slugify to `pixelcraft`) — retroactively, with production data, rather than at signup time where a simple "this slug is taken, try another" UX handles it trivially
3. The uniqueness constraint (a MongoDB unique index) can't safely be added until every existing document already has a valid, non-colliding value

Reserving the field now — even unused — means new organizations get a slug assigned at creation time from day one, and the uniqueness index can be added immediately without ever facing a backfill problem.
