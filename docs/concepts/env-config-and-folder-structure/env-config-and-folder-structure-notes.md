# Notes: Environment Config & Backend Folder Scaffold

This is the deep-dive companion to `env-config-and-folder-structure.md`. Full explanation, examples, and code — read this when the concept feels shaky, not just to refresh.

---

## Part 1: Environment Configuration

### Definition
**Environment configuration** is the practice of externalizing values that change between environments (local development, testing, staging, production) — database URIs, API keys, secrets, port numbers — out of the codebase and into environment variables, so the same code can run correctly in every environment without being edited. **Environment validation** is the additional practice of checking, at application startup, that every required variable is present and correctly shaped, rather than trusting it silently.

### Generalization
This isn't a MERN-specific idea — it's one of the core tenets of the widely-referenced "12-Factor App" methodology (a set of best practices for building SaaS applications, factor III specifically: "store config in the environment"). Every serious backend in any language or stack — Python/Django, Ruby on Rails, Go, Java/Spring — follows some version of this. The specific tool differs (zod in Node, Pydantic in Python, struct tags in Go) but the principle is universal: **never hardcode environment-specific values, and never trust unvalidated external input — including your own environment.**

### Why raw `process.env` access is fragile — a concrete failure story
Imagine three different files each read `process.env.MONGODB_URI` directly:
```js
// backend/config/db.js
mongoose.connect(process.env.MONGODB_URI);

// backend/services/billingService.js
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// backend/lib/jwt.js
jwt.sign(payload, process.env.JWT_ACCESS_SECRET);
```
Now suppose your `.env` file has a typo: `JWT_ACESS_SECRET` (missing the second `C`). What happens?
- `process.env.JWT_ACCESS_SECRET` silently evaluates to `undefined`.
- `jwt.sign(payload, undefined)` doesn't necessarily throw immediately — depending on the library, it might throw a cryptic low-level error, or in some misconfigurations, silently produce a broken or insecure token.
- You might not discover this until a user tries to log in, tests fail in a confusing way, or — worst case — it ships to production and breaks auth for everyone, with an error message that says nothing about the actual root cause (a typo in a `.env` file).

Compare that to schema validation at startup:
```js
// backend/config/env.js
import { z } from 'zod';
import dotenv from 'dotenv';
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  PORT: z.string().regex(/^\d+$/, 'PORT must be numeric'),
  MONGODB_URI: z.string().url(),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32),
  STRIPE_SECRET_KEY: z.string().startsWith('sk_'),
  STRIPE_WEBHOOK_SECRET: z.string(),
  CLOUDINARY_CLOUD_NAME: z.string(),
  CLOUDINARY_API_KEY: z.string(),
  CLOUDINARY_API_SECRET: z.string(),
  REDIS_URL: z.string().url(),
  LLM_API_KEY: z.string(),
  LLM_PROVIDER: z.enum(['gemini', 'groq']),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1); // hard stop — the app never even boots with bad config
}

export default parsed.data; // fully typed, validated config object
```
With the same `JWT_ACESS_SECRET` typo, this fails **the instant you run `npm start`**, with output like:
```
❌ Invalid environment variables:
{ JWT_ACCESS_SECRET: [ 'Required' ] }
```
That's a five-second fix instead of a debugging session that starts hours or days later, possibly in production, possibly after a demo has already gone wrong in front of an instructor.

### Every other file imports the validated object, not `process.env`
```js
// backend/services/billingService.js
import env from '../config/env.js';
const stripe = require('stripe')(env.STRIPE_SECRET_KEY);
```
This has a secondary benefit beyond safety: it makes it trivially easy to see, in one file (`config/env.js`), the *complete* list of every environment variable the entire app depends on — which is exactly what `ENV_AND_CONFIG.md` documents for humans. The schema and the doc should always match.

---

## Part 2: Backend Folder Scaffold

### Why `app.js` / `server.js` are split — walked through with a testing example
Without the split, a common pattern looks like:
```js
// backend/index.js — DON'T do this
const express = require('express');
const app = express();
app.use('/api/projects', projectRoutes);
app.listen(3000, () => console.log('Server running'));
```
The problem: this file does two unrelated jobs — *defining* the app, and *running* it as a live network service. If a test file wants to test the `/api/projects` route, it now has to actually start a real server on a real port, make a real HTTP request to `localhost:3000`, and remember to shut the server down afterward. That's slow, and it's fragile — parallel test runs can collide on the same port.

**The fix:**
```js
// backend/app.js
import express from 'express';
import projectRoutes from './routes/projectRoutes.js';

const app = express();
app.use(express.json());
app.use('/api/projects', projectRoutes);

export default app; // no .listen() here — just the built app
```
```js
// backend/server.js
import app from './app.js';
import env from './config/env.js';

app.listen(env.PORT, () => {
  console.log(`Nova backend running on port ${env.PORT}`);
});
```
Now a test file can do:
```js
// backend/__tests__/projects.test.js
import request from 'supertest';
import app from '../app.js';

test('GET /api/projects returns 200', async () => {
  const res = await request(app).get('/api/projects');
  expect(res.status).toBe(200);
});
```
Supertest talks to the `app` object directly, in-memory — no real port, no real network call, no server process to clean up. This is only possible because `app.js` never called `.listen()` in the first place.

### Why layering (routes → controllers → services → models) matters — walked through with a real request
Trace a single request through the layers, for `POST /api/projects` (creating a new project):

```js
// routes/projectRoutes.js — ONLY wiring, no logic
import express from 'express';
import { createProject } from '../controllers/projectController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { scopeToTenant } from '../middleware/scopeToTenant.js';

const router = express.Router();
router.post('/', requireAuth, scopeToTenant, createProject);
export default router;
```
```js
// controllers/projectController.js — orchestration only
import { createProjectSchema } from '../validators/projectValidators.js';
import * as projectService from '../services/projectService.js';

export async function createProject(req, res, next) {
  try {
    const validatedBody = createProjectSchema.parse(req.body);
    const project = await projectService.create(req.tenantId, validatedBody);
    res.status(201).json({ success: true, data: project });
  } catch (err) {
    next(err); // centralized error middleware handles the response shape
  }
}
```
```js
// services/projectService.js — actual business logic + DB access
import Project from '../models/Project.js';

export async function create(organizationId, data) {
  return Project.create({ ...data, organizationId }); // tenant scoping enforced here, not left to the caller to remember
}
```
```js
// models/Project.js — schema only
import mongoose from 'mongoose';

const projectSchema = new mongoose.Schema({
  name: { type: String, required: true },
  organizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  // ...
});

export default mongoose.model('Project', projectSchema);
```

Notice what each layer *doesn't* do: the route never touches `req.body`. The controller never writes a MongoDB query. The service never knows about `req`/`res`. Each file has exactly one job, which means:
- **Testability:** `projectService.create()` can be unit-tested by calling it directly with fake arguments — no Express, no HTTP, no mocking `req`/`res`.
- **Safety:** the tenant scoping (`organizationId`) is injected once, inside the service layer, by a value (`req.tenantId`) that itself came from a shared, trusted middleware (`scopeToTenant`) — not re-derived or (worse) re-typed by hand in every controller that touches a tenant-scoped model.

### Where validation lives, and why it's not inline in the controller
```js
// validators/projectValidators.js
import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
```
Keeping this separate from the controller means the exact same schema can be reused anywhere a "create project" shape needs validating — not just the HTTP route, but potentially a future internal script, a test fixture, or a different entry point (e.g., a CLI import tool) — without duplicating or drifting the validation rules.

### A common mistake this structure prevents
A frequent anti-pattern in less disciplined codebases: a controller directly calls `Project.find({ organizationId: req.user.organizationId })` inline, duplicated slightly differently in five different controllers. The moment tenant-scoping logic needs to change (say, adding a soft-delete filter — "don't return projects marked deleted"), you now have to find and update it in five places, and it's easy to miss one. With the service layer owning all `Project` queries, that filter is added in exactly one function, and every caller gets the fix automatically.
