import { Router, type RequestHandler } from 'express';
import { guestSessionSchema, rsvpSchema } from '@gatherly/shared';
import { AppError } from '../../lib/errors.ts';
import type { RateLimiters } from '../../middleware/rate-limit.ts';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import { z } from 'zod';
import type { RsvpService } from '../rsvp/rsvp.service.ts';
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
export function guestPortalRoutes(access: GuestAccessService, rsvp: RsvpService, cookieName: string, limits: RateLimiters): Router {
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

  /** FR-109 – FR-114 — answer for one of your activities; returns the refreshed page data. */
  router.put('/rsvps/:activityId', requireGuest, validateBody(rsvpSchema), async (req, res) => {
    const activityId = z.string().min(1).max(64).parse(req.params['activityId']);
    await rsvp.respond(req.guest!, activityId, (req.body as { status: 'CONFIRMED' | 'DECLINED' }).status);
    res.json({ view: await access.view(req.guest!) });
  });

  /** FR-190, FR-191 — add one activity (?activityId=…) or your whole schedule to your calendar. */
  router.get('/calendar.ics', requireGuest, async (req, res) => {
    const q = req.query['activityId'];
    const { filename, ics } = await rsvp.calendar(req.guest!, typeof q === 'string' && q ? z.string().max(64).parse(q) : undefined);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(ics);
  });

  return router;
}
