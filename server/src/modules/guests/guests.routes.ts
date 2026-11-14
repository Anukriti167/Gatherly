import { Router, type Request } from 'express';
import { z } from 'zod';
import { createGuestSchema, importGuestsSchema, updateGuestSchema } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { GuestsService } from './guests.service.ts';

const id = z.string().min(1).max(64);
const param = (req: Request, name: string): string => id.parse((req.params as Record<string, string | undefined>)[name]);

// Guest changes aren't versioned event content, so no expectedVersion here.
const createBody = z.object({ guest: createGuestSchema });
const updateBody = z.object({ changes: updateGuestSchema });

/** Mounted at /events/:eventId/guests (organisers only). */
export function guestsRoutes(guests: GuestsService): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  router.get('/', async (req, res) => {
    res.json({ guests: await guests.list(param(req, 'eventId'), authOf(req).user.id) });
  });

  router.post('/', validateBody(createBody), async (req, res) => {
    const body = req.body as z.output<typeof createBody>;
    res.status(201).json({ guest: await guests.create(param(req, 'eventId'), authOf(req).user.id, body.guest) });
  });

  // Registered before '/:guestId' so "import" isn't treated as an id.
  router.post('/import', validateBody(importGuestsSchema), async (req, res) => {
    const body = req.body as z.output<typeof importGuestsSchema>;
    res.json({ report: await guests.import(param(req, 'eventId'), authOf(req).user.id, body) });
  });

  router.patch('/:guestId', validateBody(updateBody), async (req, res) => {
    const body = req.body as z.output<typeof updateBody>;
    res.json({ guest: await guests.update(param(req, 'eventId'), param(req, 'guestId'), authOf(req).user.id, body.changes) });
  });

  router.delete('/:guestId', async (req, res) => {
    await guests.remove(param(req, 'eventId'), param(req, 'guestId'), authOf(req).user.id);
    res.status(204).end();
  });

  return router;
}
