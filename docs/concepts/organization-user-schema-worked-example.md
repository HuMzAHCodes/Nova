# Worked Example: Organization, User, Project & Client Access — A Concrete Scenario

Companion to `organization-user-schema-design.md`. This walks through one full, filled-in scenario — shown first as relational-style tables (for anyone coming from a MySQL background), then as the actual MongoDB documents Nova stores.

---

## The scenario

One organization, **"PixelCraft"**, with:
- 4 internal members: Ali (Owner), Sara (Admin), Bilal (Member), Aisha (Member)
- 3 projects: **Redesign**, **Mobile App**, **Marketing Site**
- Two internal members get elevated per-project roles: Aisha becomes Manager on Redesign, Bilal becomes Manager on Mobile App
- 2 external clients: Acme Corp (scoped to Redesign only), Globex (scoped to Mobile App only)

---

## Part 1 — General table structure (the "schema", empty of data)

Think of these as table definitions, the way you'd write `CREATE TABLE` in MySQL — just column names and types, no rows yet.

**organizations**
| Column | Type | Notes |
|---|---|---|
| id | ObjectId (PK) | |
| name | String | |
| slug | String, unique | |
| owner_id | ObjectId (FK → users.id) | |
| subscription_tier | Enum: free/pro/business | |

**users**
| Column | Type | Notes |
|---|---|---|
| id | ObjectId (PK) | |
| organization_id | ObjectId (FK → organizations.id) | NULL-ish for clients — see note below |
| email | String | |
| name | String | |
| role | Enum: owner/admin/member/client | org-level role |

**user_project_roles** *(this is the relational-table equivalent of the `projectRoles` array embedded on User in MongoDB — see Part 3)*
| Column | Type | Notes |
|---|---|---|
| id | ObjectId (PK) | |
| user_id | ObjectId (FK → users.id) | |
| project_id | ObjectId (FK → projects.id) | |
| role | Enum: manager/member/etc. | per-project override |

**projects**
| Column | Type | Notes |
|---|---|---|
| id | ObjectId (PK) | |
| organization_id | ObjectId (FK → organizations.id) | |
| name | String | |

**client_access** *(the separate collection we decided on)*
| Column | Type | Notes |
|---|---|---|
| id | ObjectId (PK) | |
| user_id | ObjectId (FK → users.id) | the client's login |
| organization_id | ObjectId (FK → organizations.id) | |
| project_id | ObjectId (FK → projects.id) | which single project they're scoped to |
| permissions | Array of strings | e.g. `['view', 'approve']` |

---

## Part 2 — The same tables, filled in with the scenario's actual data

**organizations**
| id | name | slug | owner_id | subscription_tier |
|---|---|---|---|---|
| org_001 | PixelCraft | pixelcraft | user_ali | pro |

**users**
| id | organization_id | email | name | role |
|---|---|---|---|---|
| user_ali | org_001 | ali@pixelcraft.com | Ali | owner |
| user_sara | org_001 | sara@pixelcraft.com | Sara | admin |
| user_bilal | org_001 | bilal@pixelcraft.com | Bilal | member |
| user_aisha | org_001 | aisha@pixelcraft.com | Aisha | member |
| user_acme | org_001 | contact@acme.com | Acme Contact | client |
| user_globex | org_001 | contact@globex.com | Globex Contact | client |

*(Note: the two client users still carry `organization_id: org_001` here, since they need to belong to some org for basic queries like "which org is this login associated with" — but as the concept doc explains, this field is largely irrelevant to what they can actually **do**. Their real permissions come entirely from the `client_access` table below, not from this `role: client` value.)*

**projects**
| id | organization_id | name |
|---|---|---|
| proj_redesign | org_001 | Redesign |
| proj_mobile | org_001 | Mobile App |
| proj_marketing | org_001 | Marketing Site |

**user_project_roles** *(only 2 rows — only Aisha and Bilal have overrides; everyone else just uses their org-level role on every project)*
| id | user_id | project_id | role |
|---|---|---|---|
| upr_001 | user_aisha | proj_redesign | manager |
| upr_002 | user_bilal | proj_mobile | manager |

**client_access**
| id | user_id | organization_id | project_id | permissions |
|---|---|---|---|---|
| ca_001 | user_acme | org_001 | proj_redesign | ['view', 'approve'] |
| ca_002 | user_globex | org_001 | proj_mobile | ['view', 'approve'] |

**Reading this data back in plain English:**
- Ali owns PixelCraft.
- Sara is an Admin across the whole org — no per-project overrides needed, her org-level role covers everything.
- Bilal is a regular Member org-wide, but specifically on Mobile App, he's elevated to Manager.
- Aisha is a regular Member org-wide, but specifically on Redesign, she's elevated to Manager.
- Acme's contact can view and approve deliverables on Redesign only — nothing about Mobile App or Marketing Site.
- Globex's contact can view and approve deliverables on Mobile App only — nothing about Redesign or Marketing Site.
- Neither client has any row in `user_project_roles` at all — that table is exclusively for internal per-project overrides.

---

## Part 3 — How this actually gets stored in MongoDB (not separate tables — embedded documents)

This is the one place MongoDB meaningfully differs from MySQL: instead of a separate `user_project_roles` table joined via foreign keys, the per-project roles are **embedded directly inside the User document** as an array. No join needed to read a user's own overrides — they come back in the same query that fetches the user.

**Aisha's actual User document:**
```json
{
  "_id": "user_aisha",
  "organizationId": "org_001",
  "email": "aisha@pixelcraft.com",
  "name": "Aisha",
  "role": "member",
  "projectRoles": [
    { "projectId": "proj_redesign", "role": "manager" }
  ]
}
```

**Sara's actual User document** (no overrides — the array is simply empty):
```json
{
  "_id": "user_sara",
  "organizationId": "org_001",
  "email": "sara@pixelcraft.com",
  "name": "Sara",
  "role": "admin",
  "projectRoles": []
}
```

**Acme's ClientAccess document** (a genuinely separate collection, not embedded in User — this is the Option B decision from the concept doc):
```json
{
  "_id": "ca_001",
  "userId": "user_acme",
  "organizationId": "org_001",
  "projectId": "proj_redesign",
  "permissions": ["view", "approve"]
}
```

## The key mental-model shift from MySQL to MongoDB here
In MySQL, you'd almost certainly make `user_project_roles` its own table with foreign keys, because that's the natural way to model a many-to-many relationship (one user can have overrides on many projects; one project can have override-holders across many users) — and you'd `JOIN` it in whenever you needed a user's project roles.

In MongoDB, because a user's own `projectRoles` are *always* read together with the rest of that user's data (you basically never want "give me project role overrides without knowing whose they are"), embedding them directly inside the User document avoids a join entirely — one query returns everything needed. **ClientAccess stays a separate collection instead of also being embedded**, specifically because it's queried independently in a way `projectRoles` usually isn't — e.g., "give me every client with access to Project X" is a query that doesn't want to start from Users at all, making a separate, directly-queryable collection the better fit there.
