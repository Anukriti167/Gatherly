import { Router, type Request } from 'express';
import { z } from 'zod';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import type { RsvpService } from './rsvp.service.ts';

const eventIdOf = (req: Request) => z.string().min(1).max(64).parse((req.params as Record<string, string | undefined>)['eventId']);

/** Mounted at /events/:eventId/rsvps — RSVP counts and answers for organisers (FR-115, FR-116). */
export function rsvpRoutes(rsvp: RsvpService): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);
  router.get('/', async (req, res) => {
    res.json(await rsvp.overview(eventIdOf(req), authOf(req).user.id));
  });
  return router;
}
