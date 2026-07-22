# Nova — API Reference

Status: **not yet built.** Updated endpoint-by-endpoint as each route is written and verified in Postman — not written retroactively.

## Format for each endpoint (fill in as built)
```
### METHOD /path
Auth required: Yes/No — which role(s)
Request body: { ... }
Response (success): { ... }
Response (error): { ... }
Notes: any gotcha, rate limit, or edge case
```

## Planned endpoint groups (to be filled in as built)
- **Auth** — register, login, refresh, logout, verify email, password reset
- **Organizations** — create org, invite member, list members, update role
- **Projects** — CRUD, per-project role overrides
- **Tasks** — CRUD, status updates, assignment
- **Client Portal** — scoped read-only project view, deliverable approval, billing status view
- **Billing** — Stripe checkout session, webhook handler, subscription status
- **Real-time** — Socket.io event reference (not REST, documented separately here for completeness)
- **AI** — task breakdown, client-facing summary generation
- **Analytics** — task completion, velocity, activity heatmap endpoints

---
_Last updated: not yet started._
