# Nova — Concepts Map

Index of every concept in `docs/concepts/`. Each concept lives in its own subfolder (named to match the concept's slug) containing its `.md` (tight, scannable, interview Q&A), its `-notes.md` (deep dive with examples and edge cases), and sometimes a `-worked-example.md`. Two views below into the same set: by category (how you'd actually review before an interview) and by week (how the project was actually built). Updated every time a new concept is written.

---

## By Category

### Backend
- **multi-tenancy-and-architecture/** — [concept](./concepts/multi-tenancy-and-architecture/multi-tenancy-and-architecture.md) / [notes](./concepts/multi-tenancy-and-architecture/multi-tenancy-and-architecture-notes.md) — shared-collection multi-tenancy model, `organizationId` scoping, layered architecture choice
- **env-config-and-folder-structure/** — [concept](./concepts/env-config-and-folder-structure/env-config-and-folder-structure.md) / [notes](./concepts/env-config-and-folder-structure/env-config-and-folder-structure-notes.md) — validated env config with zod, app.js/server.js split, routes/controllers/services layering
- **organization-user-schema-design/** — [concept](./concepts/organization-user-schema-design/organization-user-schema-design.md) / [notes](./concepts/organization-user-schema-design/organization-user-schema-design-notes.md) / [worked example](./concepts/organization-user-schema-design/organization-user-schema-worked-example.md) — Organization/User/ClientAccess schema design, why Client access is a separate collection, plus a concrete filled-in scenario

### Auth & Authorization
_(pending)_

### Frontend
_(pending)_

### Real-time
_(pending)_

### Billing
_(pending)_

### Client Portal
_(pending)_

### AI
_(pending)_

### Infra / DevOps
_(pending)_

### Testing
_(pending)_

### Further Implementation (Post-Week 8)
_(pending — see FURTHER_IMPLEMENTATION.md for what's planned: DB indexing deep-dive, observability, job queue patterns, transactions, GraphQL, security hardening, API versioning, search, horizontal scaling)_

---

## By Week

### Week 1 — Foundations & Backend Core
- multi-tenancy-and-architecture/
- env-config-and-folder-structure/
- organization-user-schema-design/

### Week 2 — Auth & Authorization (incl. Client role)
_(pending)_

### Week 3 — Core PM (Projects & Tasks)
_(pending)_

### Week 4 — Client Portal
_(pending)_

### Week 5 — Billing & Payments
_(pending)_

### Week 6 — Real-Time Layer
_(pending)_

### Week 7 — AI Layer + Analytics + Caching
_(pending)_

### Week 8 — Testing, Polish, Docs & Demo
_(pending)_

---
_Last updated: after switching docs/concepts/ to per-concept subfolders._
