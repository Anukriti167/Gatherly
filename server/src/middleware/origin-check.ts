import type { RequestHandler } from 'express';
import { forbidden } from '../lib/errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function originCheck(appOrigin: string): RequestHandler {
  const allowedOrigins = new Set([
    appOrigin,
    'https://x60bshkhkk.preview.c36.airoapp.ai',
    'https://letsgatherly.com',
  ]);

  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');

    if (origin) {
      return allowedOrigins.has(origin)
        ? next()
        : next(forbidden('Cross-origin request blocked'));
    }

    const referer = req.get('referer');

    if (referer) {
      try {
        if (allowedOrigins.has(new URL(referer).origin)) return next();
      } catch {
        // Fall through to forbidden.
      }
    }

    next(forbidden('Cross-origin request blocked'));
  };
}
