import { Response } from 'express';

// CONCEPT: response shaping (see docs/concepts/rest-crud-design).
// Every controller in the app calls ONE of these two functions to send a
// response — never a raw res.json({...}) written by hand. This guarantees
// every endpoint returns the exact same JSON shape, so the frontend never
// has to guess which shape a given endpoint uses.

export function sendSuccess(res: Response, data: unknown, statusCode = 200): void {
  res.status(statusCode).json({ success: true, data });
}

export function sendError(res: Response, message: string, statusCode = 400): void {
  res.status(statusCode).json({ success: false, error: message });
}