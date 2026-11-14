import type {
  ProposalApproverView,
  ProposalChange,
  ProposalChangeView,
  ProposalTimelineItem,
  ProposalView,
} from '@gatherly/shared';
import { createProposalSchema, reviseProposalSchema } from '@gatherly/shared';
import type { z } from 'zod';
import type { AppConfig } from '../../config/env.ts';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.ts';

import type { NotificationsService } from '../notifications/notifications.service.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { EventsService } from '../events/events.service.ts';
import { applyIfUnanimous, parseChanges } from './proposal-engine.ts';
import { proposalEmail } from './proposals.emails.ts';

type Tx = db.Prisma.TransactionClient;
type CreateData = z.output<typeof createProposalSchema>;
type ReviseData = z.output<typeof reviseProposalSchema>;

const fullInclude = {
  proposer: { select: { id: true, name: true } },
  revisions: { orderBy: { version: 'asc' }, include: { createdBy: { select: { name: true } } } },
  approvers: { include: { user: { select: { id: true, name: true } } } },
  decisions: { orderBy: { createdAt: 'asc' }, include: { approver: { select: { name: true } } } },
  comments: { orderBy: { createdAt: 'asc' }, include: { author: { select: { id: true, name: true } } } },
} satisfies db.Prisma.ChangeProposalInclude;
type ProposalRow = db.Prisma.ChangeProposalGetPayload<{ include: typeof fullInclude }>;

const stale = () => new AppError(409, 'STALE_VERSION', 'This proposal was revised. Review the latest version before deciding.');

const CHANGE_LABEL: Record<ProposalChange['type'], string> = {
  REMOVE_GUESTS: 'Remove guests',
  UNPUBLISH: 'Unpublish the event',
  CANCEL_EVENT: 'Cancel the event',
  COMPLETE_EVENT: 'Mark the event as completed',
};

/**
 * Change proposals on published events (FR-132 – FR-153): proposals carry typed changes, need the
 * unanimous approval of the organisers recorded when they were created, stay open through
 * objections and discussion, can be revised (resetting approvals) or withdrawn, and are applied
 * automatically once everyone approves the same version.
 */
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly notifier: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  async list(eventId: string, userId: string): Promise<ProposalView[]> {
    await this.events.authorize(eventId, userId, 'event.view');
    const rows = await this.prisma.changeProposal.findMany({ where: { eventId }, include: fullInclude, orderBy: { createdAt: 'desc' } });
    const views = await Promise.all(rows.map((r) => this.toView(r, userId)));
    return views.sort((a, b) => Number(b.status === 'OPEN') - Number(a.status === 'OPEN')); // open first, then newest
  }

  async get(eventId: string, proposalId: string, userId: string): Promise<ProposalView> {
    await this.events.authorize(eventId, userId, 'event.view');
    return this.toView(await this.find(this.prisma, eventId, proposalId), userId);
  }

  /** FR-132 – FR-137 */
  async create(eventId: string, userId: string, input: CreateData): Promise<ProposalView> {
    await this.events.authorize(eventId, userId, 'proposal.create');
    await this.validateChanges(eventId, input.changes);

    let applied = false;
    const id = await this.prisma.$transaction(async (tx) => {
      const organisers = await tx.eventMembership.findMany({ where: { eventId, status: 'ACTIVE' }, select: { userId: true } });
      const p = await tx.changeProposal.create({
        data: {
          eventId,
          proposerId: userId,
          title: input.title,
          revisions: { create: { version: 1, description: input.description, changes: input.changes, createdById: userId } },
          approvers: { create: organisers.map((o) => ({ userId: o.userId })) },
          // The proposer counts as approving their own proposal (agreed product rule).
          decisions: { create: { approverId: userId, decision: 'APPROVE', proposalVersion: 1 } },
        },
      });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'proposal.created', entityType: 'ChangeProposal', entityId: p.id, after: { title: input.title, changes: input.changes } },
        tx,
      );
      applied = await applyIfUnanimous(tx, this.audit, { proposalId: p.id, actorId: userId });
      return p.id;
    });

    const view = await this.get(eventId, id, userId);
    if (applied) await this.notifyApplied(eventId, view);
    else await this.notifyOthers(eventId, view, userId, 'created', `${view.proposer.name} proposed a change that needs your approval:`);
    return view;
  }

  /** FR-138, FR-144 */
  async approve(eventId: string, proposalId: string, userId: string, expectedVersion: number, comment?: string): Promise<ProposalView> {
    let applied = false;
    await this.prisma.$transaction(async (tx) => {
      const p = await this.assertCanDecide(tx, eventId, proposalId, userId, expectedVersion);
      const latest = await tx.proposalDecision.findFirst({
        where: { proposalId, approverId: userId, proposalVersion: p.version },
        orderBy: { createdAt: 'desc' },
      });
      if (latest?.decision === 'APPROVE') throw new AppError(409, 'ALREADY_APPROVED', 'You have already approved this version.');
      await tx.proposalDecision.create({ data: { proposalId, approverId: userId, decision: 'APPROVE', proposalVersion: p.version, comment: comment || null } });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'proposal.approved', entityType: 'ChangeProposal', entityId: proposalId, metadata: { version: p.version, comment } },
        tx,
      );
      applied = await applyIfUnanimous(tx, this.audit, { proposalId, actorId: userId });
    });
    const view = await this.get(eventId, proposalId, userId);
    if (applied) await this.notifyApplied(eventId, view);
    return view;
  }

  /** FR-138, FR-139 — an objection keeps the proposal open for discussion; it is not a rejection. */
  async object(eventId: string, proposalId: string, userId: string, expectedVersion: number, comment: string): Promise<ProposalView> {
    await this.prisma.$transaction(async (tx) => {
      const p = await this.assertCanDecide(tx, eventId, proposalId, userId, expectedVersion);
      await tx.proposalDecision.create({ data: { proposalId, approverId: userId, decision: 'OBJECT', proposalVersion: p.version, comment } });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'proposal.objected', entityType: 'ChangeProposal', entityId: proposalId, metadata: { version: p.version, comment } },
        tx,
      );
    });
    const view = await this.get(eventId, proposalId, userId);
    const name = view.approvers.find((a) => a.userId === userId)?.name ?? 'An organiser';
    await this.notifyOthers(eventId, view, userId, 'objection', `${name} objected to the proposal: “${comment}”. It stays open until everyone agrees.`);
    return view;
  }

  /** FR-141 — any organiser can discuss an open proposal. */
  async comment(eventId: string, proposalId: string, userId: string, body: string): Promise<ProposalView> {
    await this.events.authorize(eventId, userId, 'event.view');
    const p = await this.find(this.prisma, eventId, proposalId);
    if (p.status !== 'OPEN') throw badRequest('This proposal is closed.');
    await this.prisma.proposalComment.create({ data: { proposalId, authorId: userId, body } });
    const view = await this.get(eventId, proposalId, userId);
    const name = (await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? 'An organiser';
    await this.notifyOthers(eventId, view, userId, 'comment', `${name} commented: “${body}”`);
    return view;
  }

  /** FR-142, FR-143 — new version; approvals for earlier versions no longer count. */
  async revise(eventId: string, proposalId: string, userId: string, input: ReviseData): Promise<ProposalView> {
    await this.events.authorize(eventId, userId, 'proposal.create');
    await this.validateChanges(eventId, input.changes);
    let applied = false;
    await this.prisma.$transaction(async (tx) => {
      const p = await this.find(tx, eventId, proposalId);
      if (p.proposerId !== userId) throw forbidden('Only the person who made the proposal can revise it.');
      if (p.status !== 'OPEN') throw badRequest('This proposal is closed.');
      if (p.version !== input.expectedVersion) throw stale();
      const version = p.version + 1;
      const bumped = await tx.changeProposal.updateMany({
        where: { id: proposalId, version: p.version, status: 'OPEN' },
        data: { version, ...(input.title ? { title: input.title } : {}) },
      });
      if (bumped.count !== 1) throw stale();
      await tx.proposalRevision.create({ data: { proposalId, version, description: input.description, changes: input.changes, createdById: userId } });
      await tx.proposalDecision.create({ data: { proposalId, approverId: userId, decision: 'APPROVE', proposalVersion: version } });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'proposal.revised', entityType: 'ChangeProposal', entityId: proposalId, metadata: { version, changes: input.changes } },
        tx,
      );
      applied = await applyIfUnanimous(tx, this.audit, { proposalId, actorId: userId });
    });
    const view = await this.get(eventId, proposalId, userId);
    if (applied) await this.notifyApplied(eventId, view);
    else await this.notifyOthers(eventId, view, userId, 'revised', `${view.proposer.name} revised the proposal (version ${view.version}). Earlier approvals were reset — please review it again:`);
    return view;
  }

  /** FR-147, FR-148 — recorded as WITHDRAWN, separately from any rejection. */
  async withdraw(eventId: string, proposalId: string, userId: string): Promise<ProposalView> {
    await this.events.authorize(eventId, userId, 'event.view');
    await this.prisma.$transaction(async (tx) => {
      const p = await this.find(tx, eventId, proposalId);
      if (p.proposerId !== userId) throw forbidden('Only the person who made the proposal can withdraw it.');
      if (p.status !== 'OPEN') throw badRequest('This proposal is already closed.');
      await tx.changeProposal.update({ where: { id: proposalId }, data: { status: 'WITHDRAWN', closedAt: new Date(), closedReason: 'Withdrawn by the proposer' } });
      await this.audit.record({ eventId, actor: { type: 'USER', userId }, action: 'proposal.withdrawn', entityType: 'ChangeProposal', entityId: proposalId }, tx);
    });
    const view = await this.get(eventId, proposalId, userId);
    await this.notifyOthers(eventId, view, userId, 'withdrawn', `${view.proposer.name} withdrew the proposal. No changes were made.`);
    return view;
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private async find(client: Pick<PrismaClient, 'changeProposal'>, eventId: string, proposalId: string): Promise<ProposalRow> {
    const p = await client.changeProposal.findFirst({ where: { id: proposalId, eventId }, include: fullInclude });
    if (!p) throw notFound('Proposal not found');
    return p;
  }

  private async assertCanDecide(tx: Tx, eventId: string, proposalId: string, userId: string, expectedVersion: number) {
    await this.events.authorize(eventId, userId, 'proposal.decide');
    const p = await this.find(tx, eventId, proposalId);
    if (p.status !== 'OPEN') throw badRequest('This proposal is closed.');
    if (!p.approvers.some((a) => a.userId === userId)) {
      throw forbidden('You joined after this proposal was made, so your approval is not required for it.');
    }
    if (p.version !== expectedVersion) throw stale();
    return p;
  }

  /** Guests must belong to this event and still be on the list. */
  private async validateChanges(eventId: string, changes: ProposalChange[]): Promise<void> {
    for (const c of changes) {
      if (c.type === 'REMOVE_GUESTS') {
        const ids = [...new Set(c.guestIds)];
        const found = await this.prisma.guest.count({ where: { eventId, id: { in: ids }, removedAt: null } });
        if (found !== ids.length) throw badRequest('Some of the chosen guests are not on this event’s guest list.');
      }
      if (c.type === 'COMPLETE_EVENT') {
        const event = await this.prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { startsAt: true } });
        if (event.startsAt > new Date()) {
          throw badRequest('An event can only be marked as completed once it has started. To call it off, propose cancelling instead.');
        }
      }
    }
  }

  private async toView(p: ProposalRow, viewerId: string): Promise<ProposalView> {
    const current = p.revisions.at(-1)!;
    const changes = parseChanges(current.changes);

    const guestIds = changes.flatMap((c) => (c.type === 'REMOVE_GUESTS' ? c.guestIds : []));
    const guests = guestIds.length
      ? await this.prisma.guest.findMany({ where: { id: { in: guestIds } }, select: { id: true, name: true, email: true, removedAt: true } })
      : [];
    const guestById = new Map(guests.map((g) => [g.id, g]));

    const changeViews: ProposalChangeView[] = changes.map((c) => {
      if (c.type === 'REMOVE_GUESTS') {
        return {
          type: c.type,
          guests: c.guestIds.map((id) => {
            const g = guestById.get(id);
            return { id, name: g?.name ?? 'Unknown guest', email: g?.email ?? '', stillOnList: Boolean(g && !g.removedAt) };
          }),
        };
      }
      if (c.type === 'CANCEL_EVENT') return { type: c.type, reason: c.reason ?? null };
      return { type: c.type };
    });

    const latest = new Map<string, (typeof p.decisions)[number]>();
    for (const d of p.decisions) if (d.proposalVersion === p.version) latest.set(d.approverId, d);
    const approvers: ProposalApproverView[] = p.approvers
      .map((a) => {
        const d = latest.get(a.userId);
        return {
          userId: a.userId,
          name: a.user.name,
          state: d ? (d.decision === 'APPROVE' ? ('APPROVED' as const) : ('OBJECTED' as const)) : ('PENDING' as const),
          comment: d?.comment ?? null,
          decidedAt: d?.createdAt.toISOString() ?? null,
          isYou: a.userId === viewerId,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    const timeline: ProposalTimelineItem[] = [
      ...p.revisions.map((r) => ({ kind: 'revision' as const, at: r.createdAt.toISOString(), by: r.createdBy.name, version: r.version, description: r.description })),
      ...p.decisions.map((d) => ({
        kind: 'decision' as const,
        at: d.createdAt.toISOString(),
        by: d.approver.name,
        version: d.proposalVersion,
        decision: d.decision,
        comment: d.comment,
      })),
      ...p.comments.map((c) => ({ kind: 'comment' as const, at: c.createdAt.toISOString(), by: c.author.name, body: c.body, isYou: c.author.id === viewerId })),
      ...(p.closedAt ? [{ kind: 'closed' as const, at: p.closedAt.toISOString(), status: p.status, reason: p.closedReason }] : []),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const me = approvers.find((a) => a.isYou);
    return {
      id: p.id,
      eventId: p.eventId,
      title: p.title,
      status: p.status,
      version: p.version,
      proposer: p.proposer,
      description: current.description,
      changes: changeViews,
      approvers,
      approvedCount: approvers.filter((a) => a.state === 'APPROVED').length,
      requiredCount: approvers.length,
      objectionCount: approvers.filter((a) => a.state === 'OBJECTED').length,
      youAreProposer: p.proposerId === viewerId,
      youCanDecide: p.status === 'OPEN' && Boolean(me) && me!.state !== 'APPROVED',
      createdAt: p.createdAt.toISOString(),
      closedAt: p.closedAt?.toISOString() ?? null,
      closedReason: p.closedReason,
      timeline,
    };
  }

  // ─── notifications (FR-150) ────────────────────────────────────────────────

  private changeLines(view: ProposalView): string[] {
    return view.changes.map((c) => {
      if (c.type === 'REMOVE_GUESTS') return `${CHANGE_LABEL[c.type]}: ${c.guests.map((g) => `${g.name} (${g.email})`).join(', ')}`;
      if (c.type === 'CANCEL_EVENT' && c.reason) return `${CHANGE_LABEL[c.type]} — reason: ${c.reason}`;
      return CHANGE_LABEL[c.type];
    });
  }

  private async organisers(eventId: string) {
    const rows = await this.prisma.eventMembership.findMany({
      where: { eventId, status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true, email: true } }, event: { select: { name: true } } },
    });
    return { eventName: rows[0]?.event.name ?? 'your event', people: rows.map((r) => r.user) };
  }

  private path(eventId: string, proposalId: string) {
    return `/events/${eventId}?tab=proposals#proposal-${proposalId}`;
  }

  private async notifyOthers(eventId: string, view: ProposalView, actorId: string, kind: string, message: string): Promise<void> {
    const { eventName, people } = await this.organisers(eventId);
    const path = this.path(eventId, view.id);
    const needsApproval = kind === 'created' || kind === 'revised';
    await this.notifier.dispatch({
      eventId,
      kind: `proposal.${kind}`,
      url: path,
      recipients: people.filter((p) => p.id !== actorId),
      inApp: () => ({ title: `${needsApproval ? 'Approval needed' : 'Proposal update'}: ${view.title}`, body: message }),
      email: (r) =>
        proposalEmail({
          to: r.email,
          name: r.name,
          subject: `${needsApproval ? 'Approval needed' : 'Proposal update'}: “${view.title}” · ${eventName}`,
          heading: view.title,
          paragraphs: [message, `Reason: ${view.description}`],
          list: this.changeLines(view),
          url: `${this.config.appOrigin}${path}`,
        }),
    });
  }

  private async notifyApplied(eventId: string, view: ProposalView): Promise<void> {
    const { eventName, people } = await this.organisers(eventId);
    const path = this.path(eventId, view.id);
    await this.notifier.dispatch({
      eventId,
      kind: 'proposal.applied',
      url: path,
      recipients: people,
      inApp: () => ({ title: `Approved and applied: ${view.title}`, body: `Every organiser approved — ${this.changeLines(view).join('; ')}` }),
      email: (r) =>
        proposalEmail({
          to: r.email,
          name: r.name,
          subject: `Approved and applied: “${view.title}” · ${eventName}`,
          heading: 'Change approved and applied',
          paragraphs: [`Every organiser approved “${view.title}”, so it has been applied:`],
          list: this.changeLines(view),
          url: `${this.config.appOrigin}${path}`,
          actionLabel: 'Open event',
        }),
    });
  }
}

