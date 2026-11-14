import type { RequestHandler } from 'express';
import type { z } from 'zod';

/**
 * Validates and normalises `req.body` against a Zod schema (FR-204). On failure the ZodError
 * is passed to the error handler, which returns field-level messages.
 */
export function validateBody<S extends z.ZodType>(schema: S): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}
