// A custom error class for intentional, expected errors — anywhere in the
// app that needs to reject a request with a specific HTTP status code
// throws this instead of a plain Error, e.g.:
//   throw new AppError(404, 'Project not found');
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean; // true for errors we threw deliberately, as
                           // opposed to unexpected bugs/exceptions

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    // Excludes the AppError constructor itself from the generated stack
    // trace, so the trace points to where AppError was actually thrown,
    // not to this line.
    Error.captureStackTrace(this, this.constructor);
  }
}