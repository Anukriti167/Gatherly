/** Operational errors that are safe to show to the client. Anything else becomes a 500. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (message: string, fields?: Record<string, string[]>) =>
  new AppError(400, 'BAD_REQUEST', message, fields);
export const unauthorized = (message = 'Please sign in to continue') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do that') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new AppError(409, 'CONFLICT', message);
