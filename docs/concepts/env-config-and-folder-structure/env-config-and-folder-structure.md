# Concept: Environment Config & Backend Folder Scaffold

## What this concept is
Two related foundational decisions: (1) how the app manages environment variables (database URIs, secrets, API keys) safely and predictably, and (2) how the backend codebase is physically organized into folders so that every concern (routing, business logic, data access, validation) has exactly one place it lives.

## The problem it solves
Without validated env config, a missing or misspelled environment variable fails silently or late — the app starts fine, then breaks deep into runtime (e.g., a DB connection attempt) with a confusing error, far from the actual mistake. Without a disciplined folder structure, logic ends up scattered — a route file might contain business logic, a controller might run raw DB queries directly — making the code harder to test, harder to reason about, and easy to accidentally break the multi-tenancy scoping guarantees we already designed.

## What we implemented

### Env config
A single config module (`backend/config/env.js`) defines a zod schema for every required environment variable and validates `process.env` against it once, at startup. Every other file imports the validated config object — never raw `process.env` directly. If a required variable is missing or malformed, the app refuses to start and names exactly which variable is wrong.

### Folder scaffold
```
backend/
├── app.js            → builds the Express app (middleware + routes), exports it — no .listen() here
├── server.js          → imports app, calls .listen() — the only file that actually starts the server
├── config/            → env.js (validated env vars), DB connection setup, third-party client setup
├── routes/             → route definitions only (path → controller mapping), no logic
├── controllers/        → request/response orchestration, calls services — no business logic itself
├── services/            → actual business logic, DB calls, external API calls
├── models/               → Mongoose schemas only
├── middleware/            → auth checks, validation, error handling, rate limiting, tenant scoping
├── lib/                    → shared utilities (JWT helpers, response formatter, etc.)
├── hooks/                   → reusable lifecycle logic (e.g. pre/post-save hooks)
└── validators/               → zod/Joi schemas for request bodies, separate from controllers
```

**Key decisions inside this structure:**
- **`app.js` / `server.js` split** — makes the app testable: Supertest (Week 8) can import `app` directly and send it fake requests without binding to a real network port, so tests run faster and don't require managing a live server process.
- **Tenant-scoping middleware lives at `middleware/scopeToTenant.js`** — the single, shared enforcement point for the multi-tenancy guarantee from the previous concept doc. Every protected route pulls this in; no route re-implements its own scoping logic.

## Likely interview questions on this concept (with answers)

**Q: Why validate environment variables with a schema instead of just reading `process.env` directly?**
A: Direct `process.env` access fails silently on typos (a misnamed variable just returns `undefined` instead of erroring), and the failure often only surfaces much later, deep in runtime, far from the actual mistake — e.g., a missing Stripe key might not error until a customer tries to check out during a live demo. Schema validation at startup turns every misconfiguration into an immediate, clearly-named failure the moment the app boots, which is far cheaper to debug and impossible to accidentally ship.

**Q: What's the benefit of splitting `app.js` and `server.js`?**
A: It decouples "building the Express application" from "running a live server," which makes the app directly testable. Testing tools like Supertest can import the Express app object and simulate HTTP requests against it in-memory, without opening a real network port — faster test runs, and no risk of port conflicts or leftover server processes between test runs.

**Q: Why does route/controller/service layering matter beyond "it looks organized"?**
A: It creates a single, predictable place for each kind of concern, which has two concrete payoffs: testability (services can be unit-tested without mocking `req`/`res` or spinning up Express, since they contain pure business logic) and safety for cross-cutting concerns like tenant scoping — a shared middleware only works as a guarantee if every route actually goes through the same pipeline, and a disciplined folder structure is what makes "every route goes through the same pipeline" actually true in practice, rather than aspirational.

**Q: Where should validation logic (checking a request body's shape) live, and why not just inline it in the controller?**
A: In a dedicated `validators/` folder, as its own schema, imported by the controller (or applied as middleware before the controller runs). Keeping it separate means the same validation schema can be reused (e.g., the shape of a "create task" request might be validated identically whether it comes from a REST call or an internal script), and it keeps controllers thin — a controller's job is to orchestrate, not to contain business rules about what a valid request looks like.
