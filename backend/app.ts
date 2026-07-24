import express, { Request, Response } from 'express';
import cors from 'cors';

// This file builds the Express application object but deliberately
// never calls app.listen() — that responsibility belongs to server.ts.
// Keeping them separate means this `app` object can be imported directly
// by test files (e.g. Supertest) and tested in-memory, without ever
// starting a real server or binding to a real network port.
const app = express();

// Allows the frontend (running on a different origin/port) to make
// requests to this API. Without this, the browser blocks the requests
// by default under the same-origin policy.
app.use(cors());

// Parses incoming JSON request bodies into req.body automatically.
// Without this, req.body would be undefined for any JSON POST/PUT request.
app.use(express.json());

// A minimal route that doesn't touch the database or any business logic —
// its only job is to confirm the server process is alive and responding.
// Useful for quickly checking the server booted correctly, and later,
// for uptime monitoring / deployment health checks.
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'Nova backend is running' });
});

// As real features get built, their routers get mounted here, e.g.:
// import projectRoutes from './routes/projectRoutes.js';
// app.use('/api/projects', projectRoutes);
//
// Each router only defines paths and which controller handles them —
// per BACKEND_PRACTICES.md, no business logic ever lives in this file
// or in the route files themselves.

export default app;

/**
 * ─────────────────────────────────────────────────────────────
 * CONCEPT SUMMARY (for anyone reading this file)
 * ─────────────────────────────────────────────────────────────
 * What this file does:
 *   Assembles the Express application — middleware and routes —
 *   as a single exportable object, without starting a live server.
 *
 * Why the app.js / server.js split matters:
 *   It decouples "what the app does" from "running it as a live
 *   network service." This makes automated testing far simpler:
 *   a test file can import `app` and simulate HTTP requests against
 *   it directly in memory (no real port, no server process to start
 *   or tear down), which is faster and avoids port-conflict issues
 *   between test runs.
 *
 * The rule this file follows:
 *   No business logic here — only middleware setup and route
 *   mounting. Anything more belongs in routes/, controllers/,
 *   or services/, per BACKEND_PRACTICES.md.
 *
 * See docs/concepts/env-config-and-folder-structure.md and its
 * -notes.md companion for the full reasoning, with a worked
 * example of a request flowing through routes → controllers →
 * services → models.
 * ─────────────────────────────────────────────────────────────
 */