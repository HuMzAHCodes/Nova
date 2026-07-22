# Nova — Backend Practices

Same philosophy as the frontend rules — modular, independent, non-chunky — applied to backend structure.

## Layered folder structure, one concern per folder
```
backend/
├── routes/       → only route definitions (path → controller mapping), no logic
├── controllers/  → request/response handling, calls services — no business logic itself
├── services/     → actual business logic, DB calls, external API calls
├── models/       → Mongoose schemas only
├── middleware/   → auth checks, validation, error handling, rate limiting
├── lib/          → shared utilities (JWT helpers, LLM client wrapper, response formatter, etc.)
├── hooks/        → reusable lifecycle logic (e.g. pre/post-save hooks)
└── validators/   → zod/Joi schemas, separate from controllers
```

## Rules
1. **One file, one responsibility.** A route file only lists routes. A controller only orchestrates (parse request → call service → format response) — never raw DB queries inline. If a service function does more than one distinct job, split it.
2. **Independent, single-purpose middleware.** Each middleware does exactly one job (`requireAuth`, `requireRole('Admin')`, `validateBody(schema)`) and gets chained on routes — never one middleware doing multiple jobs at once.
3. **Controllers stay thin, services stay testable.** Business logic lives in `services/`, never in `controllers/`, so services can be unit-tested without spinning up Express or mocking `req`/`res`.
4. **Config centralized, never scattered.** A single `config/` handles env validation, DB connection, and third-party client setup (Stripe, LLM client) — no duplicated instantiation across files.
5. **One error-handling pattern, everywhere.** A single custom `AppError` class plus one centralized error-handling middleware — every controller throws the same shape of error.
6. **One response shape, everywhere.** A `lib/response.js` helper (`sendSuccess(res, data)`, `sendError(res, err)`) so every endpoint returns a consistent JSON shape — trivial to document in API_REFERENCE.md since the shape never varies.

---
_Applies to all backend work in this project, starting Week 1._
