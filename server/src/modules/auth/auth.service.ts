import type { ChangePasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { generateToken, getDummyPasswordHash, hashPassword, hashToken, verifyPassword } from '../../lib/crypto.ts';
import { AppError, badRequest, conflict, unauthorized } from '../../lib/errors.ts';
import type { Logger } from '../../lib/logger.ts';
import { sendInBackground, type MailMessage, type Mailer } from '../../lib/mailer.ts';
import type { PrismaClient } from '../../lib/prisma.ts';
import { passwordChangedEmail, passwordResetEmail, verifyEmailEmail } from './auth.emails.ts';
import type { RequestMeta, SessionService, SessionUser } from './session.service.ts';

const HOUR = 60 * 60 * 1000;
const RESET_TOKEN_TTL_MS = HOUR;
const VERIFY_TOKEN_TTL_MS = 48 * HOUR;

const userSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  emailVerifiedAt: true,
  createdAt: true,
} as const;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly sessions: SessionService,
    private readonly mailer: Mailer,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  /** FR-001 */
  async register(input: RegisterInput, meta: RequestMeta) {
    const existing = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });

    if (existing) {
      throw conflict('An account with this email already exists. Try signing in instead.');
    }

    const user = await this.prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
      },
      select: userSelect,
    });

    await this.sendVerificationEmail(user);

    const session = await this.sessions.create(user.id, meta);

    this.logger.info({ userId: user.id }, 'user.registered');

    return { user, session };
  }

  /** FR-002 */
  async login(input: LoginInput, meta: RequestMeta) {
    const record = await this.prisma.user.findUnique({
      where: { email: input.email },
      select: { ...userSelect, passwordHash: true },
    });

    const ok = await verifyPassword(
      input.password,
      record?.passwordHash ?? (await getDummyPasswordHash()),
    );

    if (!record || !ok) {
      this.logger.warn(
        {
          ip: meta.ipAddress,
          userFound: Boolean(record),
          passwordMatched: Boolean(record && ok),
        },
        'auth.login_failed',
      );

      throw unauthorized('Incorrect email or password');
    }

    const { passwordHash: _omit, ...user } = record;

    const session = await this.sessions.create(user.id, meta);

    return { user: user satisfies SessionUser, session };
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  /** FR-003 */
  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });

    if (!user) return;

    const token = generateToken();

    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      }),
    ]);

    const url = `${this.config.appOrigin}/reset-password?token=${encodeURIComponent(token)}`;

    this.sendInBackground(passwordResetEmail(user.email, user.name, url));
  }

  /** FR-003 */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        400,
        'INVALID_TOKEN',
        'This reset link is invalid or has expired. Please request a new one.',
      );
    }

    const passwordHash = await hashPassword(input.password);

    // Claim the token atomically so two concurrent requests can't both use it.
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      if (claimed.count !== 1) {
        throw new AppError(
          400,
          'INVALID_TOKEN',
          'This reset link has already been used.',
        );
      }

      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });

      await tx.userSession.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    this.sendInBackground(passwordChangedEmail(record.user.email, record.user.name));

    this.logger.info({ userId: record.userId }, 'auth.password_reset');
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    input: ChangePasswordInput,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });

    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect', {
        currentPassword: ['Current password is incorrect'],
      });
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.newPassword) },
    });

    await this.sessions.revokeAllForUser(userId, currentSessionId);

    this.sendInBackground(passwordChangedEmail(user.email, user.name));
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() <= Date.now()) {
      throw new AppError(
        400,
        'INVALID_TOKEN',
        'This confirmation link is invalid or has expired.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);
  }

  async resendVerification(user: SessionUser): Promise<void> {
    if (user.emailVerifiedAt) return;

    await this.sendVerificationEmail(user);
  }

  private async sendVerificationEmail(
    user: Pick<SessionUser, 'id' | 'name' | 'email'>,
  ): Promise<void> {
    const token = generateToken();

    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + VERIFY_TOKEN_TTL_MS),
        },
      }),
    ]);

    const url = `${this.config.appOrigin}/verify-email?token=${encodeURIComponent(token)}`;

    this.sendInBackground(verifyEmailEmail(user.email, user.name, url));
  }

  /**
   * Fire-and-forget so response timing doesn't reveal whether an email was sent.
   * (Replaced by the DB-backed outbox with retries and delivery status in Phase 3, FR-160.)
   */
  private sendInBackground(message: MailMessage): void {
    sendInBackground(this.mailer, this.logger, message);
  }
}
