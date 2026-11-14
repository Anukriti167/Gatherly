import type { ActionItem, NotificationsPage } from '@gatherly/shared';
import type { Logger } from '../../lib/logger.ts';
import { sendInBackground, type MailMessage, type Mailer } from '../../lib/mailer.ts';
import type { PrismaClient } from '../../lib/prisma.ts';

export interface Recipient {
  id: string;
  name: string;
  email: string;
}

/**
 * One place that tells organisers about things: every update is stored as an in-app notification
 * (dashboard bell) AND emailed, so the two never drift apart (FR-150, FR-160).
 */
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: Mailer,
    private readonly logger: Logger,
  ) {}

  async dispatch(opts: {
    eventId: string | null;
    kind: string;
    /** In-app path, e.g. /events/abc#proposal-xyz */
    url: string;
    recipients: Recipient[];
    inApp: (r: Recipient) => { title: string; body: string };
    /** Omit for in-app only (e.g. RSVP updates, which would otherwise flood inboxes). */
    email?: (r: Recipient) => MailMessage;
  }): Promise<void> {
    const unique = [...new Map(opts.recipients.map((r) => [r.id, r])).values()];
    if (unique.length === 0) return;
    await this.prisma.notification.createMany({
      data: unique.map((r) => {
        const { title, body } = opts.inApp(r);
        return { userId: r.id, eventId: opts.eventId, kind: opts.kind, title: title.slice(0, 200), body: body.slice(0, 1000), url: opts.url };
      }),
    });
    if (opts.email) for (const r of unique) sendInBackground(this.mailer, this.logger, opts.email(r));
  }

  async list(userId: string, opts: { limit?: number; before?: string } = {}): Promise<NotificationsPage> {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
    let cursorDate: Date | undefined;
    if (opts.before) {
      const cursor = await this.prisma.notification.findFirst({ where: { id: opts.before, userId }, select: { createdAt: true } });
      cursorDate = cursor?.createdAt;
    }
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
      include: { event: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      notifications: page.map((n) => ({
        id: n.id,
        eventId: n.eventId,
        eventName: n.event?.name ?? null,
        kind: n.kind,
        title: n.title,
        body: n.body,
        url: n.url,
        createdAt: n.createdAt.toISOString(),
        read: n.readAt !== null,
      })),
      unreadCount: await this.prisma.notification.count({ where: { userId, readAt: null } }),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  /** Marks the user's own notifications as read (others' ids are silently ignored). */
  async markRead(userId: string, input: { ids: string[] } | { all: true }): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...('ids' in input ? { id: { in: input.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  /**
   * Things waiting on the user across all their events: publication approvals and change
   * proposals where they're a required approver and haven't approved the current version.
   */
  async actionItems(userId: string): Promise<ActionItem[]> {
    const items: ActionItem[] = [];

    const rounds = await this.prisma.approvalRound.findMany({
      where: { kind: 'PUBLICATION', status: 'OPEN', approvers: { some: { userId } }, event: { status: 'PENDING_APPROVAL' } },
      include: { event: { select: { id: true, name: true, version: true } }, decisions: { where: { approverId: userId } } },
    });
    for (const r of rounds) {
      if (r.event.version !== r.eventVersion) continue;
      const latest = r.decisions.filter((d) => d.eventVersion === r.eventVersion).sort((a, b) => +b.createdAt - +a.createdAt)[0];
      if (latest?.decision === 'APPROVE') continue;
      items.push({ kind: 'PUBLICATION_APPROVAL', eventId: r.event.id, eventName: r.event.name, title: 'Approve publishing', url: `/events/${r.event.id}`, since: r.createdAt.toISOString() });
    }

    const proposals = await this.prisma.changeProposal.findMany({
      where: { status: 'OPEN', approvers: { some: { userId } }, event: { status: 'PUBLISHED' } },
      include: { event: { select: { id: true, name: true } }, decisions: { where: { approverId: userId } } },
    });
    for (const p of proposals) {
      const latest = p.decisions.filter((d) => d.proposalVersion === p.version).sort((a, b) => +b.createdAt - +a.createdAt)[0];
      if (latest?.decision === 'APPROVE') continue;
      items.push({
        kind: 'PROPOSAL_DECISION',
        eventId: p.event.id,
        eventName: p.event.name,
        title: `Approve proposal: ${p.title}`,
        url: `/events/${p.event.id}?tab=proposals#proposal-${p.id}`,
        since: p.updatedAt.toISOString(),
      });
    }

    // Guest photos waiting for approval (one item per event, not one notification per photo).
    const pendingPhotos = await this.prisma.photo.groupBy({
      by: ['eventId'],
      where: { status: 'PENDING_APPROVAL', event: { status: { in: ['PUBLISHED', 'COMPLETED'] }, memberships: { some: { userId, status: 'ACTIVE' } } } },
      _count: { _all: true },
      _min: { createdAt: true },
    });
    if (pendingPhotos.length) {
      const names = new Map(
        (await this.prisma.event.findMany({ where: { id: { in: pendingPhotos.map((p) => p.eventId) } }, select: { id: true, name: true } })).map((e) => [e.id, e.name]),
      );
      for (const p of pendingPhotos) {
        const n = p._count._all;
        items.push({
          kind: 'PHOTO_REVIEW',
          eventId: p.eventId,
          eventName: names.get(p.eventId) ?? 'Event',
          title: `Review ${n} guest photo${n === 1 ? '' : 's'}`,
          url: `/events/${p.eventId}?tab=photos`,
          since: (p._min.createdAt ?? new Date()).toISOString(),
        });
      }
    }

    return items.sort((a, b) => (a.since < b.since ? -1 : 1)); // oldest first — longest waiting
  }
}
