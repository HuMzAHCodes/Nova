import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/AppError.js';

// The centralized error handler — must be registered LAST in app.ts,
// after every route. Express identifies this as error-handling
// middleware specifically because it has four parameters (err first);
// a normal middleware function has three. See the concept notes for
// exactly why arity matters here.
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
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