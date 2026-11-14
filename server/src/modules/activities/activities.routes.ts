import { Router, type Request } from 'express';
import { z } from 'zod';
import { createActivitySchema, updateActivitySchema } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { ActivitiesService } from './activities.service.ts';

const id = z.string().min(1).max(64);

/** Route params, including ones merged from the parent router (`:eventId`), validated. */
const param = (req: Request, name: string): string => id.parse((req.params as Record<string, string | undefined>)[name]);
const expectedVersion = z.number().int().positive().optional();

const createBody = z.object({ activity: createActivitySchema, expectedVersion });
const updateBody = z.object({ changes: updateActivitySchema, expectedVersion });

/** Mounted at /events/:eventId/activities */
export function activitiesRoutes(activities: ActivitiesService): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  router.get('/', async (req, res) => {
    const eventId = param(req, 'eventId');
    res.json({ activities: await activities.list(eventId, authOf(req).user.id) });
  });

  router.post('/', validateBody(createBody), async (req, res) => {
    const eventId = param(req, 'eventId');
    const body = req.body as z.output<typeof createBody>;
    const activity = await activities.create(eventId, authOf(req).user.id, body.activity, body.expectedVersion);
    res.status(201).json({ activity });
  });

  router.get('/:activityId', async (req, res) => {
    const eventId = param(req, 'eventId');
    const activityId = param(req, 'activityId');
    res.json({ activity: await activities.get(eventId, activityId, authOf(req).user.id) });
  });

  router.patch('/:activityId', validateBody(updateBody), async (req, res) => {
    const eventId = param(req, 'eventId');
    const activityId = param(req, 'activityId');
    const body = req.body as z.output<typeof updateBody>;
    const activity = await activities.update(eventId, activityId, authOf(req).user.id, body.changes, body.expectedVersion);
    res.json({ activity });
  });

  router.delete('/:activityId', async (req, res) => {
    const eventId = param(req, 'eventId');
    const activityId = param(req, 'activityId');
    const v = req.query['expectedVersion'];
    await activities.remove(eventId, activityId, authOf(req).user.id, typeof v === 'string' ? expectedVersion.parse(Number(v)) : undefined);
    res.status(204).end();
  });

  return router;
}
