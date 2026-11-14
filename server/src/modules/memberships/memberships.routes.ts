import { Router, type Request } from 'express';
import { z } from 'zod';
import { inviteCoAdminSchema } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import type { RateLimiters } from '../../middleware/rate-limit.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { MembershipsService } from './memberships.service.ts';

const id = z.string().min(1).max(64);
const param = (req: Request, name: string): string => id.parse((req.params as Record<string, string | undefined>)[name]);

/** Mounted at /events/:eventId/members */
export function membershipsRoutes(memberships: MembershipsService, limits: RateLimiters): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  router.get('/', async (req, res) => {
    res.json({ members: await memberships.list(param(req, 'eventId'), authOf(req).user.id) });
  });

  // Rate-limited: the "no account with that email" answer must not become an account-lookup oracle.
  router.post('/', limits.memberInvite, validateBody(inviteCoAdminSchema), async (req, res) => {
    const member = await memberships.invite(param(req, 'eventId'), authOf(req).user.id, (req.body as { email: string }).email);
    res.status(201).json({ member });
  });

  router.delete('/:membershipId', async (req, res) => {
    await memberships.remove(param(req, 'eventId'), authOf(req).user.id, param(req, 'membershipId'));
    res.status(204).end();
  });

  // The invitee's own response.
  router.post('/me/accept', async (req, res) => {
    await memberships.respond(param(req, 'eventId'), authOf(req).user.id, true);
    res.status(204).end();
  });

  router.post('/me/decline', async (req, res) => {
    await memberships.respond(param(req, 'eventId'), authOf(req).user.id, false);
    res.status(204).end();
  });

  return router;
}

/** Mounted at /invitations — co-admin invitations addressed to the signed-in user. */
export function myInvitationsRoutes(memberships: MembershipsService): Router {
  const router = Router();
  router.use(requireUser);
  router.get('/', async (req, res) => {
    res.json({ invitations: await memberships.myInvitations(authOf(req).user.id) });
  });
  return router;
}
