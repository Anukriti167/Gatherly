import type { UpdateProfileInput } from '@gatherly/shared';
import type { PrismaClient } from '../../lib/prisma.ts';
import type { SessionUser } from '../auth/session.service.ts';

const userSelect = { id: true, name: true, email: true, phone: true, emailVerifiedAt: true, createdAt: true } as const;

export class UsersService {
  constructor(private readonly prisma: PrismaClient) {}

  /** FR-004, FR-005 — name and optional phone. (Email change and profile image: Phase 2.) */
  async updateProfile(userId: string, input: UpdateProfileInput): Promise<SessionUser> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
      },
      select: userSelect,
    });
  }
}
