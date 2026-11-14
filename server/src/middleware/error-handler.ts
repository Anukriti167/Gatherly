import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { ApiErrorBody } from '@gatherly/shared';
import { AppError } from '../lib/errors.ts';
import { db } from '../lib/prisma.ts';
import type { Logger } from '../lib/logger.ts';

export function zodFieldErrors(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (fields[key] ??= []).push(issue.message);
  }
  return fields;
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  const body: ApiErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
};

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    let status = 500;
    let body: ApiErrorBody = { error: { code: 'INTERNAL', message: 'Something went wrong. Please try again.' } };

    if (err instanceof AppError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, fields: err.fields } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = { error: { code: 'VALIDATION', message: 'Please check the highlighted fields', fields: zodFieldErrors(err) } };
    } else if (err instanceof db.Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      status = 409;
      body = { error: { code: 'CONFLICT', message: 'That record already exists' } };
    } else if (err?.type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'BAD_JSON', message: 'Malformed JSON body' } };
    } else if (err?.type === 'entity.too.large') {
      status = 413;
      body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' } };
    }

    if (status >= 500) {
      logger.error({ err, method: req.method, url: req.originalUrl }, 'Unhandled error');
    }
    res.status(status).json(body);
  };
}
