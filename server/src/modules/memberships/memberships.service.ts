import type { CoAdminInvitation, EventMember } from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.ts';

import type { NotificationsService } from '../notifications/notifications.service.ts';
import type { PrismaClient } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { EventsService } from '../events/events.service.ts';
import {
  findOpenPublicationRound,
  openPublicationRound,
  publishIfApproved,
  supersedeOpenPublicationRound,
} from '../publication/approval-rounds.ts';
import { dropApproverFromOpenProposals } from '../proposals/proposal-engine.ts';
import { coAdminInvitationEmail, coAdminRemovedEmail } from './memberships.emails.ts';

const memberInclude = {
  user: { select: { id: true, name: true, email: true } },
  invitedBy: { select: { name: true } },
} as const;

/**
 * Event organisers: one owner plus co-admins (FR-060 – FR-066).
 * Co-admin invitations go to existing Gatherly accounts and must be accepted.
 * Membership changes don't alter event content, so they don't bump the event version.
 */
export class MembershipsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly notifier: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  /** All organisers (incl. pending invites) — visible to every active organiser. */
  async list(eventId: string, userId: string): Promise<EventMember[]> {
    await this.events.authorize(eventId, userId, 'event.view');
    const rows = await this.prisma.eventMembership.findMany({
      where: { eventId, status: { in: ['ACTIVE', 'INVITED'] } },
      include: memberInclude,
      orderBy: [{ role: 'asc' }, { invitedAt: 'asc' }], // OWNER sorts before CO_ADMIN
    });
    return rows.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      status: m.status,
      invitedAt: m.invitedAt.toISOString(),
      respondedAt: m.respondedAt?.toISOString() ?? null,
      invitedByName: m.invitedBy?.name ?? null,
      isYou: m.userId === userId,
    }));
  }

  /** FR-062 — owner only; the invitee must already have a Gatherly account. */
  async invite(eventId: string, ownerId: string, email: string): Promise<EventMember> {
    const { event } = await this.events.authorize(eventId, ownerId, 'coadmins.manage');

    const invitee = await this.prisma.user.findUnique({ where: { email }, select: { id: true, name: true, email: true } });
    if (!invitee) {
      throw new AppError(404, 'USER_NOT_FOUND', 'There is no Gatherly account with that email. Ask them to sign up first, then invite them.');
    }
    if (invitee.id === ownerId) throw badRequest('You are already the owner of this event.');

    const existing = await this.prisma.eventMembership.findUnique({ where: { eventId_userId: { eventId, userId: invitee.id } } });
    if (existing?.status === 'ACTIVE') throw conflict(`${invitee.name} is already an organiser of this event.`);
    if (existing?.status === 'INVITED') throw conflict(`${invitee.name} has already been invited and hasn't responded yet.`);

    const membership = await this.prisma.$transaction(async (tx) => {
      // Re-inviting someone who declined or was removed reuses their row (one row per user per event).
      const m = existing
        ? await tx.eventMembership.update({
            where: { id: existing.id },
            data: { role: 'CO_ADMIN', status: 'INVITED', invitedById: ownerId, invitedAt: new Date(), respondedAt: null, removedAt: null },
            include: memberInclude,
          })
        : await tx.eventMembership.create({
            data: { eventId, userId: invitee.id, role: 'CO_ADMIN', status: 'INVITED', invitedById: ownerId },
            include: memberInclude,
          });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId: ownerId }, action: 'coadmin.invited', entityType: 'EventMembership', entityId: m.id, after: { userId: invitee.id, email: invitee.email } },
        tx,
      );
      return m;
    });

    const inviterName = membership.invitedBy?.name ?? 'The event owner';
    await this.notifier.dispatch({
      eventId: null, // invitee isn't a member yet — the notification must not link into the event
      kind: 'coadmin.invited',
      url: '/dashboard',
      recipients: [invitee],
      inApp: () => ({ title: `Invitation to co-organise ${event.name}`, body: `${inviterName} invited you as a co-admin. Accept or decline on your dashboard.` }),
      email: (r) => coAdminInvitationEmail({ to: r.email, inviteeName: r.name, inviterName, eventName: event.name, url: `${this.config.appOrigin}/dashboard` }),
    });

    return {
      id: membership.id,
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      role: membership.role,
      status: membership.status,
      invitedAt: membership.invitedAt.toISOString(),
      respondedAt: null,
      invitedByName: membership.invitedBy?.name ?? null,
      isYou: false,
    };
  }

  /** Pending co-admin invitations for the signed-in user (dashboard). */
  async myInvitations(userId: string): Promise<CoAdminInvitation[]> {
    const rows = await this.prisma.eventMembership.findMany({
      where: { userId, status: 'INVITED', event: { status: { not: 'CANCELLED' } } },
      include: { event: { select: { id: true, name: true, startsAt: true, timezone: true } }, invitedBy: { select: { name: true } } },
      orderBy: { invitedAt: 'desc' },
    });
    return rows.map((m) => ({
      membershipId: m.id,
      eventId: m.event.id,
      eventName: m.event.name,
      eventStartsAt: m.event.startsAt.toISOString(),
      eventTimezone: m.event.timezone,
      invitedByName: m.invitedBy?.name ?? null,
      invitedAt: m.invitedAt.toISOString(),
    }));
  }

  /** The invitee accepts or declines their own pending invitation. */
  async respond(eventId: string, userId: string, accept: boolean): Promise<void> {
    const m = await this.prisma.eventMembership.findUnique({ where: { eventId_userId: { eventId, userId } } });
    if (!m || m.status !== 'INVITED') throw notFound('Invitation not found or no longer valid');

    await this.prisma.$transaction(async (tx) => {
      // Conditional update guards against a concurrent cancel by the owner.
      const res = await tx.eventMembership.updateMany({
        where: { id: m.id, status: 'INVITED' },
        data: { status: accept ? 'ACTIVE' : 'DECLINED', respondedAt: new Date() },
      });
      if (res.count !== 1) throw notFound('Invitation not found or no longer valid');
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: accept ? 'coadmin.accepted' : 'coadmin.declined', entityType: 'EventMembership', entityId: m.id },
        tx,
      );
    });
  }

  /** FR-063 — owner removes a co-admin, or cancels a pending invitation. */
  async remove(eventId: string, ownerId: string, membershipId: string): Promise<void> {
    const { event } = await this.events.authorize(eventId, ownerId, 'coadmins.manage');
    const m = await this.prisma.eventMembership.findFirst({ where: { id: membershipId, eventId }, include: memberInclude });
    if (!m || (m.status !== 'ACTIVE' && m.status !== 'INVITED')) throw notFound('Organiser not found');
    if (m.role === 'OWNER') throw forbidden('The owner cannot be removed. Transfer ownership first.');

    await this.prisma.$transaction(async (tx) => {
      await tx.eventMembership.update({ where: { id: m.id }, data: { status: 'REMOVED', removedAt: new Date() } });

      // A removed organiser can no longer approve. If they were a required approver of an open
      // publication round, restart it with the current organisers so it can't stall forever.
      const open = await findOpenPublicationRound(tx, eventId);
      if (open && open.approvers.some((a) => a.userId === m.userId)) {
        await supersedeOpenPublicationRound(tx, eventId);
        const { roundId } = await openPublicationRound(tx, {
          eventId,
          initiatorId: ownerId,
          eventVersion: event.version,
          reason: `${m.user.name} was removed as an organiser — approvals reset`,
        });
        await publishIfApproved(tx, this.audit, { eventId, roundId, actorId: ownerId });
      }
      // Same for open change proposals: the removed organiser's approval is no longer required.
      await dropApproverFromOpenProposals(tx, this.audit, { eventId, userId: m.userId, actorId: ownerId });
      await this.audit.record(
        {
          eventId,
          actor: { type: 'USER', userId: ownerId },
          action: m.status === 'INVITED' ? 'coadmin.invitation_cancelled' : 'coadmin.removed',
          entityType: 'EventMembership',
          entityId: m.id,
          before: { userId: m.userId, email: m.user.email, status: m.status },
        },
        tx,
      );
    });

    if (m.status === 'ACTIVE') {
      await this.notifier.dispatch({
        eventId: null, // they no longer have access to the event
        kind: 'coadmin.removed',
        url: '/dashboard',
        recipients: [m.user],
        inApp: () => ({ title: `Co-admin access ended: ${event.name}`, body: 'You are no longer an organiser of this event.' }),
        email: (r) => coAdminRemovedEmail({ to: r.email, name: r.name, eventName: event.name }),
      });
    }
  }
}
