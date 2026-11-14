import { Router, type Request } from 'express';
import { z } from 'zod';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import type { EventHistoryService } from './history.service.ts';

const id = z.string().min(1).max(64);
const query = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  before: z.string().min(1).max(64).optional(),
  category: z.enum(['event', 'activity', 'guests', 'organisers', 'approval', 'proposal']).optional(),
});
const eventIdOf = (req: Request) => id.parse((req.params as Record<string, string | undefined>)['eventId']);

/** Mounted at /events/:eventId/history — the event's readable activity log (organisers only). */
export function historyRoutes(history: EventHistoryService): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);
  router.get('/', async (req, res) => {
    res.json(await history.list(eventIdOf(req), authOf(req).user.id, query.parse(req.query)));
  });
  return router;
}
