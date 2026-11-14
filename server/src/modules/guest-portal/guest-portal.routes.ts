import { Router, type RequestHandler } from 'express';
import { guestSessionSchema } from '@gatherly/shared';
import { AppError } from '../../lib/errors.ts';
import type { RateLimiters } from '../../middleware/rate-limit.ts';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import { z } from 'zod';
import type { GuestAccessService, GuestContext } from './guest-access.service.ts';

const fromAccountSchema = z.object({ eventId: z.string().min(1).max(64) });

declare global {
  namespace Express {
    interface Request {
      /** Set for guest-portal requests with a valid guest session cookie. */
      guest?: GuestContext;
    }
  }
}

const noGuest = () => new AppError(401, 'GUEST_SESSION_REQUIRED', 'Please open the invitation link from your email to see this event.');

/** Mounted at /guest — the personalised guest website's API (no account needed). */
export function guestPortalRoutes(access: GuestAccessService, cookieName: string, limits: RateLimiters): Router {
  const router = Router();

  const requireGuest: RequestHandler = async (req, res, next) => {
    const ctx = await access.validate(req.cookies?.[cookieName] as string | undefined);
    if (!ctx) {
      access.clearCookie(res);
      return next(noGuest());
    }
    req.guest = ctx;
    next();
  };

  /** FR-088, FR-092 — exchange the link token for a guest session cookie. */
  router.post('/session', limits.guestLink, validateBody(guestSessionSchema), async (req, res) => {
    const { token, expiresAt } = await access.exchange((req.body as { token: string }).token);
    access.setCookie(res, token, expiresAt);
    res.status(204).end();
  });

  /** FR-006 — open your guest page from the dashboard (signed in, verified email). */
  router.post('/session/from-account', requireUser, validateBody(fromAccountSchema), async (req, res) => {
    const { token, expiresAt } = await access.openFromAccount(authOf(req).user.id, (req.body as { eventId: string }).eventId);
    access.setCookie(res, token, expiresAt);
    res.status(204).end();
  });

  router.post('/logout', async (req, res) => {
    const ctx = await access.validate(req.cookies?.[cookieName] as string | undefined);
    if (ctx) await access.endSession(ctx.sessionId);
    access.clearCookie(res);
    res.status(204).end();
  });

  router.get('/event', requireGuest, async (req, res) => {
    res.json({ view: await access.view(req.guest!) });
  });

  return router;
}
