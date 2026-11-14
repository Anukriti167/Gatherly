import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  approveProposalSchema,
  createProposalSchema,
  objectProposalSchema,
  proposalCommentSchema,
  reviseProposalSchema,
} from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { ProposalsService } from './proposals.service.ts';

const id = z.string().min(1).max(64);
const param = (req: Request, name: string): string => id.parse((req.params as Record<string, string | undefined>)[name]);

/** Mounted at /events/:eventId/proposals */
export function proposalsRoutes(proposals: ProposalsService): Router {
  const router = Router({ mergeParams: true });
  router.use(requireUser);

  router.get('/', async (req, res) => {
    res.json({ proposals: await proposals.list(param(req, 'eventId'), authOf(req).user.id) });
  });

  router.post('/', validateBody(createProposalSchema), async (req, res) => {
    const body = req.body as z.output<typeof createProposalSchema>;
    res.status(201).json({ proposal: await proposals.create(param(req, 'eventId'), authOf(req).user.id, body) });
  });

  router.get('/:proposalId', async (req, res) => {
    res.json({ proposal: await proposals.get(param(req, 'eventId'), param(req, 'proposalId'), authOf(req).user.id) });
  });

  router.post('/:proposalId/approve', validateBody(approveProposalSchema), async (req, res) => {
    const { expectedVersion, comment } = req.body as z.output<typeof approveProposalSchema>;
    res.json({ proposal: await proposals.approve(param(req, 'eventId'), param(req, 'proposalId'), authOf(req).user.id, expectedVersion, comment) });
  });

  router.post('/:proposalId/object', validateBody(objectProposalSchema), async (req, res) => {
    const { expectedVersion, comment } = req.body as z.output<typeof objectProposalSchema>;
    res.json({ proposal: await proposals.object(param(req, 'eventId'), param(req, 'proposalId'), authOf(req).user.id, expectedVersion, comment) });
  });

  router.post('/:proposalId/comments', validateBody(proposalCommentSchema), async (req, res) => {
    const { body } = req.body as z.output<typeof proposalCommentSchema>;
    res.json({ proposal: await proposals.comment(param(req, 'eventId'), param(req, 'proposalId'), authOf(req).user.id, body) });
  });

  router.post('/:proposalId/revise', validateBody(reviseProposalSchema), async (req, res) => {
    const body = req.body as z.output<typeof reviseProposalSchema>;
    res.json({ proposal: await proposals.revise(param(req, 'eventId'), param(req, 'proposalId'), authOf(req).user.id, body) });
  });

  router.post('/:proposalId/withdraw', async (req, res) => {
    res.json({ proposal: await proposals.withdraw(param(req, 'eventId'), param(req, 'proposalId'), authOf(req).user.id) });
  });

  return router;
}
