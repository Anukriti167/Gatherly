import type { AppConfig } from '../../config/env.ts';
import type { Logger } from '../../lib/logger.ts';
import type { PrismaClient } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { NotificationsService } from '../notifications/notifications.service.ts';
import { emailLayout } from '../../lib/mailer.ts';

/**
 * Moves things to "Completed" once their time has passed (FR-017, FR-018):
 *  - activities of a live (Published) event whose end time has passed → COMPLETED;
 *  - Published events whose end time has passed → COMPLETED (open proposals are closed and the
 *    organisers are notified).
 * Runs periodically in-process (single-process GoDaddy host) and is safe to run repeatedly.
 */
export class CompletionService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
    private readonly notifier: NotificationsService,
    private readonly config: AppConfig,
    private readonly logger: Logger,
  ) {}

  async run(now: Date = new Date()): Promise<{ events: string[]; activities: number }> {
    // FR-018 — activities that have finished, in events that are live.
    const activities = await this.prisma.activity.updateMany({
      where: { status: 'SCHEDULED', endsAt: { lte: now }, event: { status: 'PUBLISHED' } },
      data: { status: 'COMPLETED' },
    });

    const due = await this.prisma.event.findMany({
      where: { status: 'PUBLISHED', endsAt: { lte: now } },
      select: { id: true, name: true },
    });
    const completed: string[] = [];
    for (const e of due) {
      const done = await this.prisma.$transaction(async (tx) => {
        // Conditional so concurrent runs can't complete the same event twice.
        const res = await tx.event.updateMany({
          where: { id: e.id, status: 'PUBLISHED' },
          data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } },
        });
        if (res.count !== 1) return false;
        await tx.activity.updateMany({ where: { eventId: e.id, status: 'SCHEDULED' }, data: { status: 'COMPLETED' } });
        await tx.changeProposal.updateMany({
          where: { eventId: e.id, status: 'OPEN' },
          data: { status: 'CLOSED', closedAt: now, closedReason: 'The event has ended' },
        });
        await this.audit.record(
          { eventId: e.id, actor: { type: 'SYSTEM' }, action: 'event.completed', entityType: 'Event', entityId: e.id, metadata: { reason: 'ended' } },
          tx,
        );
        return true;
      });
      if (done) {
        completed.push(e.id);
        await this.notifyCompleted(e.id, e.name, 'The event has ended and is now marked as completed. It moves to your past events.');
      }
    }
    if (completed.length || activities.count) {
      this.logger.info({ events: completed.length, activities: activities.count }, 'completion.sweep');
    }
    return { events: completed, activities: activities.count };
  }

  async notifyCompleted(eventId: string, eventName: string, message: string): Promise<void> {
    const organisers = await this.prisma.eventMembership.findMany({
      where: { eventId, status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    const url = `/events/${eventId}`;
    await this.notifier.dispatch({
      eventId,
      kind: 'event.completed',
      url,
      recipients: organisers.map((o) => o.user),
      inApp: () => ({ title: `Completed: ${eventName}`, body: message }),
      email: (r) => ({
        to: r.email,
        subject: `Completed: “${eventName}”`,
        text: `Hi ${r.name},\n\n${message}\n\nOpen event: ${this.config.appOrigin}${url}\n`,
        html: emailLayout({ heading: 'Event completed', paragraphs: [`Hi ${r.name},`, message], action: { label: 'Open event', url: `${this.config.appOrigin}${url}` } }),
      }),
    });
  }

  /** Starts the periodic sweep (every minute) — not used in tests, which call run() directly. */
  start(intervalMs = 60_000): () => void {
    const tick = () => this.run().catch((err: unknown) => this.logger.error({ err }, 'completion.sweep_failed'));
    void tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref();
    return () => clearInterval(timer);
  }
}
