import type { ApprovalRoundView, PublicationState } from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { AppError, badRequest, forbidden } from '../../lib/errors.ts';

import type { NotificationsService } from '../notifications/notifications.service.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { EventsService } from '../events/events.service.ts';
import { findOpenPublicationRound, openPublicationRound, publishIfApproved } from './approval-rounds.ts';
import { approvalRequestedEmail, changesRequestedEmail, eventPublishedEmail } from './publication.emails.ts';

const roundInclude = {
  initiatedBy: { select: { name: true } },
  approvers: { include: { user: { select: { id: true, name: true } } } },
  decisions: { orderBy: { createdAt: 'asc' } },
} satisfies db.Prisma.ApprovalRoundInclude;
type RoundRow = db.Prisma.ApprovalRoundGetPayload<{ include: typeof roundInclude }>;

const stale = () =>
  new AppError(409, 'STALE_VERSION', 'The event changed since you opened it. Review the latest version before deciding.');

function toView(r: RoundRow, viewerId: string): ApprovalRoundView {
  const latest = new Map<string, (typeof r.decisions)[number]>();
  for (const d of r.decisions) latest.set(d.approverId, d);
  const approvers = r.approvers
    .map((a) => {
      const d = latest.get(a.userId);
      const counts = d && d.eventVersion === r.eventVersion;
      return {
        userId: a.userId,
        name: a.user.name,
        state: counts ? (d.decision === 'APPROVE' ? ('APPROVED' as const) : ('CHANGES_REQUESTED' as const)) : ('PENDING' as const),
        decidedAt: counts ? d.createdAt.toISOString() : null,
        comment: counts ? d.comment : null,
        isYou: a.userId === viewerId,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: r.id,
    status: r.status,
    eventVersion: r.eventVersion,
    initiatedByName: r.initiatedBy.name,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    closedAt: r.closedAt?.toISOString() ?? null,
    approvers,
    approvedCount: approvers.filter((a) => a.state === 'APPROVED').length,
    requiredCount: approvers.length,
  };
}

/** Initial publication with unanimous approval (FR-015, FR-222 – FR-230). */
export class PublicationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly notifier: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async state(eventId: string, userId: string): Promise<PublicationState> {
    const { event } = await this.events.authorize(eventId, userId, 'event.view');
    const rounds = await this.prisma.approvalRound.findMany({
      where: { eventId, kind: 'PUBLICATION' },
      include: roundInclude,
      orderBy: { createdAt: 'desc' },
    });
    const views = rounds.map((r) => toView(r, userId));
    const open = views.find((r) => r.status === 'OPEN') ?? null;
    const current = open ?? views[0] ?? null;
    const me = open?.approvers.find((a) => a.isYou);
    return {
      eventStatus: event.status,
      eventVersion: event.version,
      current,
      youCanApprove: Boolean(open && me && me.state !== 'APPROVED' && open.eventVersion === event.version),
      history: views.filter((r) => r !== current),
    };
  }

  /** FR-223 — any organiser can submit a Draft. */
  async submit(eventId: string, userId: string, expectedVersion: number): Promise<PublicationState> {
    const { event } = await this.events.authorize(eventId, userId, 'publication.submit');
    if (event.version !== expectedVersion) throw stale();
    // FR-015: required information — an event needs at least one activity before publishing.
    if ((await this.prisma.activity.count({ where: { eventId } })) === 0) {
      throw badRequest('Add at least one activity before submitting the event for approval.');
    }

    let published = false;
    let roundId = '';
    await this.prisma.$transaction(async (tx) => {
      const moved = await tx.event.updateMany({
        where: { id: eventId, status: 'DRAFT', version: expectedVersion },
        data: { status: 'PENDING_APPROVAL' },
      });
      if (moved.count !== 1) throw stale();
      ({ roundId } = await openPublicationRound(tx, { eventId, initiatorId: userId, eventVersion: expectedVersion, reason: 'Submitted for publication' }));
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'publication.submitted', entityType: 'ApprovalRound', entityId: roundId, metadata: { eventVersion: expectedVersion } },
        tx,
      );
      // A sole organiser's submission is already unanimous.
      published = await publishIfApproved(tx, this.audit, { eventId, roundId, actorId: userId });
    });

    if (published) await this.notifyPublished(eventId);
    else await this.notifyApprovers(eventId, roundId, userId);
    return this.state(eventId, userId);
  }

  /** FR-225 — approve this exact version. */
  async approve(eventId: string, userId: string, expectedVersion: number, comment?: string): Promise<PublicationState> {
    const round = await this.assertCanDecide(eventId, userId, expectedVersion);
    let published = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.approvalDecision.create({
        data: { roundId: round.id, approverId: userId, decision: 'APPROVE', eventVersion: round.eventVersion, comment: comment || null },
      });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'publication.approved', entityType: 'ApprovalRound', entityId: round.id, metadata: { eventVersion: round.eventVersion, comment } },
        tx,
      );
      published = await publishIfApproved(tx, this.audit, { eventId, roundId: round.id, actorId: userId });
    });
    if (published) await this.notifyPublished(eventId);
    return this.state(eventId, userId);
  }

  /** FR-227 — send the event back to Draft with a comment. */
  async requestChanges(eventId: string, userId: string, expectedVersion: number, comment: string): Promise<PublicationState> {
    const round = await this.assertCanDecide(eventId, userId, expectedVersion, { allowIfApproved: true });
    await this.prisma.$transaction(async (tx) => {
      const back = await tx.event.updateMany({
        where: { id: eventId, status: 'PENDING_APPROVAL', version: round.eventVersion },
        data: { status: 'DRAFT' },
      });
      if (back.count !== 1) throw stale();
      await tx.approvalDecision.create({
        data: { roundId: round.id, approverId: userId, decision: 'REQUEST_CHANGES', eventVersion: round.eventVersion, comment },
      });
      await tx.approvalRound.update({ where: { id: round.id }, data: { status: 'CHANGES_REQUESTED', closedAt: new Date() } });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'publication.changes_requested', entityType: 'ApprovalRound', entityId: round.id, metadata: { eventVersion: round.eventVersion, comment } },
        tx,
      );
    });
    await this.notifyChangesRequested(eventId, userId, comment);
    return this.state(eventId, userId);
  }

  private async assertCanDecide(eventId: string, userId: string, expectedVersion: number, opts: { allowIfApproved?: boolean } = {}) {
    const { event } = await this.events.authorize(eventId, userId, 'publication.decide');
    const round = await findOpenPublicationRound(this.prisma, eventId);
    if (!round) throw new AppError(409, 'NO_OPEN_ROUND', 'There is no approval waiting on this event.');
    // FR-224: only organisers in the snapshot taken when the round opened may decide.
    if (!round.approvers.some((a) => a.userId === userId)) {
      throw forbidden('You joined after this approval round started, so your approval is not required for it.');
    }
    if (event.version !== expectedVersion || round.eventVersion !== expectedVersion) throw stale();
    if (!opts.allowIfApproved) {
      const mine = await this.prisma.approvalDecision.findFirst({
        where: { roundId: round.id, approverId: userId, eventVersion: round.eventVersion },
        orderBy: { createdAt: 'desc' },
      });
      if (mine?.decision === 'APPROVE') throw new AppError(409, 'ALREADY_APPROVED', 'You have already approved this version.');
    }
    return round;
  }

  // ─── Notifications (FR-230) — in-app + email ────────────────────────────────

  private async organisers(eventId: string) {
    const rows = await this.prisma.eventMembership.findMany({
      where: { eventId, status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true, email: true } }, event: { select: { name: true } } },
    });
    return { eventName: rows[0]?.event.name ?? 'your event', people: rows.map((r) => r.user) };
  }

  private async notifyApprovers(eventId: string, roundId: string, requesterId: string) {
    const round = await this.prisma.approvalRound.findUniqueOrThrow({
      where: { id: roundId },
      include: { event: { select: { name: true } }, initiatedBy: { select: { name: true } }, approvers: { include: { user: { select: { id: true, name: true, email: true } } } } },
    });
    const path = `/events/${eventId}`;
    await this.notifier.dispatch({
      eventId,
      kind: 'publication.requested',
      url: path,
      recipients: round.approvers.map((a) => a.user).filter((u) => u.id !== requesterId),
      inApp: () => ({ title: `Approval needed: publish ${round.event.name}`, body: `${round.initiatedBy.name} submitted the event for publication. It goes live once every organiser approves.` }),
      email: (r) => approvalRequestedEmail({ to: r.email, name: r.name, requesterName: round.initiatedBy.name, eventName: round.event.name, url: `${this.config.appOrigin}${path}` }),
    });
  }

  private async notifyPublished(eventId: string) {
    const { eventName, people } = await this.organisers(eventId);
    const path = `/events/${eventId}`;
    await this.notifier.dispatch({
      eventId,
      kind: 'publication.published',
      url: path,
      recipients: people,
      inApp: () => ({ title: `Published: ${eventName}`, body: 'All organisers approved — the event is live and guests can be invited.' }),
      email: (r) => eventPublishedEmail({ to: r.email, name: r.name, eventName, url: `${this.config.appOrigin}${path}` }),
    });
  }

  private async notifyChangesRequested(eventId: string, requesterId: string, comment: string) {
    const { eventName, people } = await this.organisers(eventId);
    const requester = people.find((p) => p.id === requesterId)?.name ?? 'An organiser';
    const path = `/events/${eventId}`;
    await this.notifier.dispatch({
      eventId,
      kind: 'publication.changes_requested',
      url: path,
      recipients: people.filter((p) => p.id !== requesterId),
      inApp: () => ({ title: `Changes requested: ${eventName}`, body: `${requester}: “${comment}”. The event is back in Draft.` }),
      email: (r) => changesRequestedEmail({ to: r.email, name: r.name, requesterName: requester, eventName, comment, url: `${this.config.appOrigin}${path}` }),
    });
  }
}
