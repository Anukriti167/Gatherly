import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { ApiErrorBody } from '@gatherly/shared';

const passThrough: RequestHandler = (_req, _res, next) => next();

/**
 * In-memory rate limiting — appropriate for the single-process GoDaddy Node.js host.
 * If the app is ever scaled horizontally, swap the store for a shared one.
 */
export function createRateLimiters(enabled: boolean) {
  const make = (windowMs: number, limit: number, message: string): RequestHandler => {
    if (!enabled) return passThrough;
    const body: ApiErrorBody = { error: { code: 'RATE_LIMITED', message } };
    return rateLimit({ windowMs, limit, standardHeaders: 'draft-8', legacyHeaders: false, message: body });
  };

  const MINUTE = 60_000;
  return {
    api: make(MINUTE, 300, 'Too many requests. Please slow down.'),
    login: make(15 * MINUTE, 20, 'Too many sign-in attempts. Please wait a few minutes and try again.'),
    register: make(60 * MINUTE, 10, 'Too many accounts created from this network. Please try again later.'),
    passwordReset: make(15 * MINUTE, 5, 'Too many password reset requests. Please try again later.'),
    memberInvite: make(60 * MINUTE, 30, 'Too many invitations sent. Please try again later.'),
    // Opening invitation links: generous for real guests, but stops token guessing.
    guestLink: make(15 * MINUTE, 30, 'Too many attempts. Please wait a few minutes and open your invitation link again.'),
  };
}

export type RateLimiters = ReturnType<typeof createRateLimiters>;
