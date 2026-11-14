import type { RequestHandler } from 'express';
import { forbidden } from '../lib/errors.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated APIs. Session cookies are SameSite=Lax; in addition,
 * every state-changing request must carry an Origin (or Referer) matching the app origin.
 * Browsers always send Origin on cross-origin POST/PUT/PATCH/DELETE, so forged requests fail.
 */
export function originCheck(appOrigin: string): RequestHandler {
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();

    const origin = req.get('origin');
    if (origin) return origin === appOrigin ? next() : next(forbidden('Cross-origin request blocked'));

    const referer = req.get('referer');
    if (referer) {
      try {
        if (new URL(referer).origin === appOrigin) return next();
      } catch {
        /* fall through */
      }
    }
    next(forbidden('Cross-origin request blocked'));
  };
}
