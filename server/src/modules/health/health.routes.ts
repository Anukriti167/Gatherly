import { Router } from 'express';
import type { PrismaClient } from '../../lib/prisma.ts';

/** Liveness + database connectivity check — used to verify a deployment end to end. */
export function healthRoutes(prisma: PrismaClient): Router {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', database: 'ok' });
    } catch {
      res.status(503).json({ status: 'degraded', database: 'unreachable' });
    }
  });
  return router;
}
