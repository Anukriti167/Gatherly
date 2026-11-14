import type { CookieOptions, Response } from 'express';
import type { CurrentUser } from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { generateToken, hashToken } from '../../lib/crypto.ts';
import type { PrismaClient } from '../../lib/prisma.ts';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

const sessionUserSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

export function toCurrentUser(user: SessionUser): CurrentUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    emailVerified: user.emailVerifiedAt !== null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Server-side sessions stored in Postgres. The cookie holds a random token; only its SHA-256
 * hash is stored, and sessions can be revoked instantly (logout, password reset).
 */
export class SessionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly config: AppConfig,
  ) {}

  async create(userId: string, meta: RequestMeta): Promise<{ token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + this.config.session.ttlMs);
    await this.prisma.userSession.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt,
        ipAddress: meta.ipAddress?.slice(0, 64),
        userAgent: meta.userAgent?.slice(0, 512),
      },
    });
    return { token, expiresAt };
  }

  /** Returns the session's user if the token is valid; refreshes the sliding expiry. */
  async validate(token: string): Promise<{ user: SessionUser; sessionId: string; expiresAt: Date; refreshed: boolean } | null> {
    if (!token || token.length > 128) return null;
    const session = await this.prisma.userSession.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: sessionUserSelect } },
    });
    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now) return null;

    let { expiresAt } = session;
    let refreshed = false;
    if (now - session.lastSeenAt.getTime() > this.config.session.touchIntervalMs) {
      expiresAt = new Date(now + this.config.session.ttlMs);
      refreshed = true;
      await this.prisma.userSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(now), expiresAt } });
    }
    return { user: session.user, sessionId: session.id, expiresAt, refreshed };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string, exceptSessionId?: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  private cookieOptions(expiresAt?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.session.secureCookie,
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    };
  }

  setCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(this.config.session.cookieName, token, this.cookieOptions(expiresAt));
  }

  clearCookie(res: Response): void {
    res.clearCookie(this.config.session.cookieName, this.cookieOptions());
  }
}
