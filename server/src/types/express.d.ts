import type { SessionUser } from '../modules/auth/session.service.ts';

declare global {
  namespace Express {
    interface Request {
      /** Set by the `loadSession` middleware when a valid user session cookie is present. */
      auth?: { user: SessionUser; sessionId: string };
    }
  }
}

export {};
