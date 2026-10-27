import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { AppError } from '../lib/AppError.js';

// The centralized error handler — must be registered LAST in app.ts,
// after every route. Express identifies this as error-handling
// middleware specifically because it has four parameters (err first);
// a normal middleware function has three. See the concept notes for
// exactly why arity matters here.
//
// BUG FOUND DURING POSTMAN TESTING (Week 3): sending an invalid ObjectId
// string (e.g. a literal placeholder like "<your-userId>") to
// createTaskSchema.parse() correctly threw — but the error was a raw
// ZodError, which is NOT an instance of AppError, so it fell into the
// generic "unexpected error" branch below and returned a scary 500
// instead of a clean, informative 400. Every zod .parse() call across
// every controller in the app (auth, organization, project, task,
// pagination validators) shares this exact same gap — fixed HERE, once,
// centrally, rather than wrapping every individual .parse() call in its
// own try/catch throughout the codebase.
//
// SAME PATTERN, SECOND CLASS (malformed-id-handling concept): a path
// parameter that is not a valid ObjectId (e.g. /api/projects/abc) makes
// Mongoose throw a CastError when the query is built. That is a caller
// mistake, not a server failure, so it is turned into a 400 here, once,
// for every route — present and future.
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  if (err instanceof ZodError) {
    // A validation failure is an EXPECTED kind of error (the client sent
    // something malformed), not a bug — deserves a clean 400 with the
    // actual field-level problem, not a generic 500. err.issues gives a
    // structured list of every validation failure, not just the first one.
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    // CONCEPT: malformed-id-handling. Mongoose could not convert a
    // client-supplied value to the type the schema expects (most often a
    // path ID that is not 24 hex characters). The message never echoes
    // the offending value back to the caller.
    const message =
      err.kind === 'ObjectId' ? 'Invalid ID format' : `Invalid value for ${err.path}`;
    res.status(400).json({ success: false, error: message });
    return;
  }

  if ((err as { code?: number }).code === 11000) {
    // CONCEPT: input-normalization. A unique index rejected the write (for
    // example two invites for the same email racing past the findOne check).
    // That is a conflict the caller caused, not a server bug.
    res.status(409).json({ success: false, error: 'A record with this value already exists' });
    return;
  }

  if (err instanceof AppError) {
    // A deliberately-thrown, expected error — safe to show its message
    // directly to the client, along with the status code it was given.
    res.status(err.statusCode).json({ success: false, error: err.message });
    return;
  }

  // Anything else is unexpected — a genuine bug or unhandled exception.
  // Log the full error server-side for debugging, but never leak internal
  // details (stack traces, file paths, raw error messages) to the client.
  console.error('Unexpected error:', err);
  res.status(500).json({ success: false, error: 'Something went wrong' });
}
