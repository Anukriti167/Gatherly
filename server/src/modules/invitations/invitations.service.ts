import type { GuestInvitationView } from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { generateToken, hashToken } from '../../lib/crypto.ts';
import { badRequest, notFound } from '../../lib/errors.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { EventsService } from '../events/events.service.ts';
import type { OutboxService } from '../outbox/outbox.service.ts';
import { invitationEmail } from './invitations.emails.ts';

type Tx = db.Prisma.TransactionClient;

/**
 * Ends a guest's access: invitation revoked and every guest session closed (FR-090, FR-203).
 * Used by "revoke", by guest removal, and by approved removal proposals.
 */
export async function revokeGuestAccess(tx: Tx, guestId: string, revokedById: string | null): Promise<void> {
  const now = new Date();
  const inv = await tx.invitation.findUnique({ where: { guestId }, select: { id: true } });
  if (!inv) return;
  await tx.invitation.update({ where: { id: inv.id }, data: { status: 'REVOKED', revokedAt: now, revokedById } });
  await tx.guestSession.updateMany({ where: { invitationId: inv.id, revokedAt: null }, data: { revokedAt: now } });
}

/** Guest invitations (FR-083 – FR-091): personal links, sending via the outbox, revocation. */
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly config: AppConfig,
  ) {}

  /** Invitation + delivery status for every guest on the list. */
  async list(eventId: string, userId: string): Promise<GuestInvitationView[]> {
    await this.events.authorize(eventId, userId, 'event.view');
    const guests = await this.prisma.guest.findMany({
      where: { eventId, removedAt: null },
      select: {
        id: true,
        invitation: { include: { emails: { orderBy: { createdAt: 'desc' }, take: 1, select: { status: true, lastError: true } } } },
      },
    });
    return guests.map(({ id, invitation: inv }) => {
      const email = inv?.emails[0];
      return {
        guestId: id,
        status: !inv || !inv.lastSentAt ? 'NOT_INVITED' : inv.status === 'REVOKED' ? 'REVOKED' : 'INVITED',
        delivery: email ? (email.status === 'SENDING' ? 'QUEUED' : email.status) : null,
        deliveryError: email?.status === 'FAILED' ? email.lastError : null,
        sendCount: inv?.sendCount ?? 0,
        lastSentAt: inv?.lastSentAt?.toISOString() ?? null,
        lastAccessedAt: inv?.lastAccessedAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * FR-083 – FR-086 — sends (or re-sends) personal invitation links. Only for published events
   * (FR-226). Without guestIds, everyone not yet invited gets one. Re-sending rotates the link.
   */
  async send(eventId: string, userId: string, guestIds?: string[]): Promise<{ queued: number }> {
    const { event } = await this.events.authorize(eventId, userId, 'invitations.send');
    const guests = await this.prisma.guest.findMany({
      where: {
        eventId,
        removedAt: null,
        ...(guestIds ? { id: { in: guestIds } } : { OR: [{ invitation: null }, { invitation: { lastSentAt: null } }] }),
      },
      include: { assignments: true, invitation: true },
    });
    if (guestIds && guests.length !== new Set(guestIds).size) throw badRequest('Some of the chosen guests are not on this event’s guest list.');
    if (guests.length === 0) return { queued: 0 };

    const activities = await this.prisma.activity.findMany({ where: { eventId, status: { not: 'CANCELLED' } }, orderBy: { startsAt: 'asc' } });
    const owner = await this.prisma.eventMembership.findFirst({ where: { eventId, role: 'OWNER', status: 'ACTIVE' }, include: { user: { select: { name: true } } } });
    const organiserName = event.organiserContactName ?? owner?.user.name ?? null;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      for (const g of guests) {
        const token = generateToken();
        const inv = await tx.invitation.upsert({
          where: { guestId: g.id },
          create: { eventId, guestId: g.id, tokenHash: hashToken(token), sendCount: 1, firstSentAt: now, lastSentAt: now },
          update: { tokenHash: hashToken(token), status: 'ACTIVE', revokedAt: null, revokedById: null, sendCount: { increment: 1 }, lastSentAt: now, firstSentAt: g.invitation?.firstSentAt ?? now },
        });
        const mine = g.allActivities ? activities : activities.filter((a) => g.assignments.some((x) => x.activityId === a.id));
        await this.outbox.enqueue(
          {
            ...invitationEmail({
              to: g.email,
              guestName: g.name,
              event,
              activities: mine.map((a) => ({ name: a.name, startsAt: a.startsAt, timezone: a.timezone, venue: a.venueName ?? a.venueAddress })),
              organiserName,
              url: `${this.config.appOrigin}/i/${token}`,
            }),
            toName: g.name,
          },
          { kind: 'invitation', eventId, invitationId: inv.id },
          tx,
        );
      }
      await this.audit.record(
        {
          eventId,
          actor: { type: 'USER', userId },
          action: 'invitations.sent',
          entityType: 'Event',
          entityId: eventId,
          metadata: { count: guests.length, resent: guests.filter((g) => g.invitation?.lastSentAt).length },
        },
        tx,
      );
    });
    return { queued: guests.length };
  }

  /** FR-090 — the link stops working immediately and any open guest session ends. */
  async revoke(eventId: string, guestId: string, userId: string): Promise<void> {
    await this.events.authorize(eventId, userId, 'invitations.revoke');
    const guest = await this.prisma.guest.findFirst({ where: { id: guestId, eventId }, include: { invitation: true } });
    if (!guest?.invitation) throw notFound('This guest has no invitation');
    await this.prisma.$transaction(async (tx) => {
      await revokeGuestAccess(tx, guestId, userId);
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'invitation.revoked', entityType: 'Guest', entityId: guestId, before: { name: guest.name, email: guest.email } },
        tx,
      );
    });
  }

  /** Re-queues a failed invitation email (organiser "retry"). */
  async retryDelivery(eventId: string, guestId: string, userId: string): Promise<void> {
    await this.events.authorize(eventId, userId, 'invitations.send');
    const inv = await this.prisma.invitation.findFirst({ where: { guestId, eventId }, include: { emails: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    const email = inv?.emails[0];
    if (!email || email.status !== 'FAILED') throw badRequest('There is no failed invitation email to retry.');
    await this.outbox.retry(email.id);
  }
}
