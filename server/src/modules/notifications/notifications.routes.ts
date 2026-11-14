import { Router } from 'express';
import { z } from 'zod';
import { markNotificationsReadSchema, type MarkNotificationsReadInput } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { NotificationsService } from './notifications.service.ts';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.string().min(1).max(64).optional(),
});

/** Mounted at /me — the signed-in user's notifications and things waiting on them. */
export function meRoutes(notifications: NotificationsService): Router {
  const router = Router();
  router.use(requireUser);

  router.get('/notifications', async (req, res) => {
    const q = listQuery.parse(req.query);
    res.json(await notifications.list(authOf(req).user.id, q));
  });

  router.post('/notifications/read', validateBody(markNotificationsReadSchema), async (req, res) => {
    const updated = await notifications.markRead(authOf(req).user.id, req.body as MarkNotificationsReadInput as { ids: string[] } | { all: true });
    res.json({ updated });
  });

  router.get('/action-items', async (req, res) => {
    res.json({ items: await notifications.actionItems(authOf(req).user.id) });
  });

  return router;
}
