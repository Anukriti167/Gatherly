import { Router, type Request } from 'express';
import { z } from 'zod';
import { sendInvitationsSchema } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { InvitationsService } from './invitations.service.ts';

const id = z.string().min(1).max(64);
const param = (req: Request, name: string): string =>
  id.parse((req.params as Record<string, string | undefined>)[name]);

/** Mounted at /events/:eventId/invitations (organisers). */
export function invitationsRoutes(invitations: InvitationsService): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  router.get('/', async (req, res) => {
    res.json({
      invitations: await invitations.list(
        param(req, 'eventId'),
        authOf(req).user.id,
      ),
    });
  });

  // Temporary diagnostic endpoint.
  router.get('/outbox-diagnostics', async (req, res) => {
    res.json(
      await invitations.outboxDiagnostics(
        param(req, 'eventId'),
        authOf(req).user.id,
      ),
    );
  });

  router.post('/send', validateBody(sendInvitationsSchema), async (req, res) => {
    const { guestIds } = req.body as z.output<typeof sendInvitationsSchema>;
    res.json(
      await invitations.send(
        param(req, 'eventId'),
        authOf(req).user.id,
        guestIds,
      ),
    );
  });

  router.post('/:guestId/revoke', async (req, res) => {
    await invitations.revoke(
      param(req, 'eventId'),
      param(req, 'guestId'),
      authOf(req).user.id,
    );
    res.status(204).end();
  });

  router.post('/:guestId/retry', async (req, res) => {
    await invitations.retryDelivery(
      param(req, 'eventId'),
      param(req, 'guestId'),
      authOf(req).user.id,
    );
    res.status(204).end();
  });

  return router;
}
