import type { RequestHandler } from 'express';
import { unauthorized } from '../lib/errors.ts';
import type { SessionService } from '../modules/auth/session.service.ts';

/** Attaches `req.auth` when a valid session cookie is present. Never rejects. */
export function loadSession(sessions: SessionService, cookieName: string): RequestHandler {
  return async (req, res, next) => {
    const token: unknown = req.cookies?.[cookieName];
    if (typeof token !== 'string') return next();

    const result = await sessions.validate(token);
    if (!result) {
      sessions.clearCookie(res);
      return next();
    }
    if (result.refreshed) sessions.setCookie(res, token, result.expiresAt);
    req.auth = { user: result.user, sessionId: result.sessionId };
    next();
  };
}

/** Rejects with 401 unless a user session is present. */
export const requireUser: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthorized());
  next();
};

/** Narrowing helper for handlers mounted behind `requireUser`. */
export function authOf(req: Express.Request): NonNullable<Express.Request['auth']> {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
