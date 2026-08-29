import express, { Request, Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/authenticate.js';
import authRoutes from './routes/authRoutes.js';
import organizationRoutes from './routes/organizationRoutes.js';
import projectRoutes from './routes/projectRoutes.js';

// This file builds the Express application object but deliberately
// never calls app.listen() — that responsibility belongs to server.ts.
// Keeping them separate means this `app` object can be imported directly
// by test files (e.g. Supertest) and tested in-memory, without ever
// starting a real server or binding to a real network port.
const app = express();

// Allows the frontend (running on a different origin/port) to make
// requests to this API. `credentials: true` is REQUIRED for the httpOnly
// refresh-token cookie to actually be sent/received cross-origin — without
// it, the browser silently drops the cookie regardless of sameSite
// settings. See docs/concepts/jwt-auth-design.
app.use(cors({ origin: true, credentials: true }));

// Parses incoming JSON request bodies into req.body automatically.
// Without this, req.body would be undefined for any JSON POST/PUT request.
app.use(express.json());

// CONCEPT: jwt-auth-design. Parses the Cookie header into req.cookies,
// which authController.refresh and authController.logout both rely on to
// read/clear the httpOnly refresh token cookie.
app.use(cookieParser());

// A minimal route that doesn't touch the database or any business logic —
// its only job is to confirm the server process is alive and responding.
// Useful for quickly checking the server booted correctly, and later,
// for uptime monitoring / deployment health checks.
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({ success: true, message: 'Nova backend is running' });
});

// CONCEPT: jwt-auth-design. Auth routes are UNAUTHENTICATED by design —
// register/login/refresh/logout are how a user OBTAINS authentication in
// the first place, so `authenticate` is never applied to this router.
app.use('/api/auth', authRoutes);

// CONCEPT: REST resource mounting (see rest-crud-design concept).
// `authenticate` runs FIRST on every protected route below — it's what
// populates req.user (previously a placeholder throughout Week 1) from
// the verified JWT. scopeToTenant (applied per-route inside each of
// these routers) then reads from the req.user this middleware sets.
app.use('/api/organizations', authenticate, organizationRoutes);
app.use('/api', authenticate, projectRoutes);

// IMPORTANT: this must be registered LAST, after every route. Express
// identifies it as error-handling middleware by its four-parameter
// signature, and only routes errors to middleware registered AFTER the
// point where next(err) was called — see the centralized-error-handling
// concept notes for the full explanation.
app.use(errorHandler);

export default app;