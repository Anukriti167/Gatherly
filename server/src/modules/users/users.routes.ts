import { Router } from 'express';
import { updateProfileSchema, type UpdateProfileInput } from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import { validateBody } from '../../middleware/validate.ts';
import { toCurrentUser } from '../auth/session.service.ts';
import type { UsersService } from './users.service.ts';

export function usersRoutes(users: UsersService): Router {
  const router = Router();
  router.use(requireUser);

  router.patch('/me', validateBody(updateProfileSchema), async (req, res) => {
    const user = await users.updateProfile(authOf(req).user.id, req.body as UpdateProfileInput);
    res.json({ user: toCurrentUser(user) });
  });

  return router;
}
