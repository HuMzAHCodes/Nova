# Nova — Database Schema

Status: **not yet built.** This file is a living document — updated the moment each Mongoose model is created (Week 1–2), not written all at once at the end.

For each model, this doc will record:
- The schema fields and types
- Relationships to other models (embedded vs referenced, and why)
- Indexes added and why
- Any tradeoff worth remembering (e.g. why a field is denormalized)

## Planned models (to be filled in as built)

### Organization
_(pending — Week 1)_

### User
_(pending — Week 1, includes org role + optional per-project role overrides)_

### Project
_(pending — Week 3)_

### Task
_(pending — Week 3)_

### ClientAccess / Client-scoped view
_(pending — Week 4, supports the client portal's read-only + approval permission model)_

### Subscription / Billing
_(pending — Week 5, synced with Stripe subscription state)_

### Comment / Activity Log
_(pending — Week 3–4, feeds both real-time comments and AI weekly/client summaries)_

---
_Last updated: not yet started._
