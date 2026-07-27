import { Request, Response, NextFunction, RequestHandler } from 'express';
// RequestHandler is a built-in Express type describing the shape of any
// route handler / middleware function: (req, res, next) => void (or similar).
// Using it here means catchAsync works for both routes and middleware.

// Wraps an async route handler so any rejected promise inside it is
// automatically forwarded to Express's error-handling chain via next(err),
// instead of being silently lost (Express does not catch async rejections
// on its own — see the concept notes for why).
//
// Usage:
//   router.get('/projects/:id', catchAsync(async (req, res) => {
//     const project = await Project.findById(req.params.id);
//     if (!project) throw new AppError(404, 'Project not found');
//     res.json({ success: true, data: project });
//   }));
export function catchAsync(fn: RequestHandler): RequestHandler {
  // catchAsync takes a handler as input and returns a NEW handler as
  // output — this pattern is called a "higher-order function" (a function
  // that takes and/or returns another function).

  return (req: Request, res: Response, next: NextFunction) => {
    // this is the actual function Express will call for the route.
    // It doesn't run fn's logic directly — it wraps the call so errors
    // can be intercepted.

    Promise.resolve(fn(req, res, next)).catch(next);
    // fn(req, res, next)  → calls your actual async handler, which returns
    //                        a Promise (since it's declared "async").
    // Promise.resolve(...) → if fn somehow returns a non-promise value
    //                        (e.g. a sync handler), this wraps it in a
    //                        Promise anyway, so .catch() always works.
    // .catch(next)        → if the Promise rejects (an error was thrown
    //                        or awaited call failed), pass that error
    //                        straight into next(err). Express then routes
    //                        it to your error-handling middleware instead
    //                        of crashing the process or hanging silently.
  };
}