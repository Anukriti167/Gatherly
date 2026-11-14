import { Router, type Request } from 'express';
import { z } from 'zod';
import { approveSchema, requestChangesSchema, submitForApprovalSchema } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { PublicationService } from './publication.service.ts';

const id = z.string().min(1).max(64);
const eventIdOf = (req: Request): string => id.parse((req.params as Record<string, string | undefined>)['eventId']);

/** Mounted at /events/:eventId/publication */
export function publicationRoutes(publication: PublicationService): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  router.get('/', async (req, res) => {
    res.json({ publication: await publication.state(eventIdOf(req), authOf(req).user.id) });
  });

  router.post('/submit', validateBody(submitForApprovalSchema), async (req, res) => {
    const { expectedVersion } = req.body as z.output<typeof submitForApprovalSchema>;
    res.json({ publication: await publication.submit(eventIdOf(req), authOf(req).user.id, expectedVersion) });
  });

  router.post('/approve', validateBody(approveSchema), async (req, res) => {
    const { expectedVersion, comment } = req.body as z.output<typeof approveSchema>;
    res.json({ publication: await publication.approve(eventIdOf(req), authOf(req).user.id, expectedVersion, comment) });
  });

  router.post('/request-changes', validateBody(requestChangesSchema), async (req, res) => {
    const { expectedVersion, comment } = req.body as z.output<typeof requestChangesSchema>;
    res.json({ publication: await publication.requestChanges(eventIdOf(req), authOf(req).user.id, expectedVersion, comment) });
  });

  return router;
}
