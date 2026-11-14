import { Router } from 'express';
import { z } from 'zod';
import { createEventSchema, updateEventSchema, type CreateEventData } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { EventsService } from './events.service.ts';

/** Update body: the event fields plus the version the editor started from (stale-edit protection). */
const updateBodySchema = z.object({
  changes: updateEventSchema,
  expectedVersion: z.number().int().positive().optional(),
});

const eventIdParam = z.string().min(1).max(64);

export function eventsRoutes(events: EventsService): Router {
  const router = Router();
  router.use(requireUser);

  router.get('/', async (req, res) => {
    res.json({ events: await events.listForUser(authOf(req).user.id) });
  });

  router.post('/', validateBody(createEventSchema), async (req, res) => {
    const event = await events.create(authOf(req).user.id, req.body as CreateEventData);
    res.status(201).json({ event });
  });

  router.get('/:eventId', async (req, res) => {
    const eventId = eventIdParam.parse(req.params['eventId']);
    res.json({ event: await events.get(eventId, authOf(req).user.id) });
  });

  router.patch('/:eventId', validateBody(updateBodySchema), async (req, res) => {
    const eventId = eventIdParam.parse(req.params['eventId']);
    const body = req.body as z.infer<typeof updateBodySchema>;
    const event = await events.update(eventId, authOf(req).user.id, body.changes, body.expectedVersion);
    res.json({ event });
  });

  return router;
}
