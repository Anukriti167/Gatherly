import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type ChangePasswordInput,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@gatherly/shared';
import { authOf, requireUser } from '../../middleware/authenticate.ts';
import type { RateLimiters } from '../../middleware/rate-limit.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { AuthService } from './auth.service.ts';
import { toCurrentUser, type RequestMeta, type SessionService } from './session.service.ts';

const verifyEmailSchema = z.object({ token: z.string().min(32).max(128) });

function metaOf(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.get('user-agent') };
}

export function authRoutes(auth: AuthService, sessions: SessionService, limits: RateLimiters): Router {
  const router = Router();

  router.post('/register', limits.register, validateBody(registerSchema), async (req, res) => {
    const { user, session } = await auth.register(req.body as RegisterInput, metaOf(req));
    sessions.setCookie(res, session.token, session.expiresAt);
    res.status(201).json({ user: toCurrentUser(user) });
  });

  router.post('/login', limits.login, validateBody(loginSchema), async (req, res) => {
    const { user, session } = await auth.login(req.body as LoginInput, metaOf(req));
    sessions.setCookie(res, session.token, session.expiresAt);
    res.json({ user: toCurrentUser(user) });
  });

  router.post('/logout', async (req, res) => {
    if (req.auth) await auth.logout(req.auth.sessionId);
    sessions.clearCookie(res);
    res.status(204).end();
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: toCurrentUser(authOf(req).user) });
  });

  router.post('/forgot-password', limits.passwordReset, validateBody(forgotPasswordSchema), async (req, res) => {
    await auth.requestPasswordReset((req.body as ForgotPasswordInput).email);
    res.status(202).json({ message: 'If an account exists for that email, a reset link is on its way.' });
  });

  router.post('/reset-password', limits.passwordReset, validateBody(resetPasswordSchema), async (req, res) => {
    await auth.resetPassword(req.body as ResetPasswordInput);
    sessions.clearCookie(res);
    res.json({ message: 'Your password has been reset. Please sign in.' });
  });

  router.post('/change-password', requireUser, limits.login, validateBody(changePasswordSchema), async (req, res) => {
    const { user, sessionId } = authOf(req);
    await auth.changePassword(user.id, sessionId, req.body as ChangePasswordInput);
    res.json({ message: 'Password changed. Other devices have been signed out.' });
  });

  router.post('/verify-email', limits.passwordReset, validateBody(verifyEmailSchema), async (req, res) => {
    await auth.verifyEmail((req.body as { token: string }).token);
    res.json({ message: 'Email confirmed.' });
  });

  router.post('/resend-verification', requireUser, limits.passwordReset, async (req, res) => {
    await auth.resendVerification(authOf(req).user);
    res.status(202).json({ message: 'Confirmation email sent.' });
  });

  return router;
}
