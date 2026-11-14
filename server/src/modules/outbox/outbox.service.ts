import type { Logger } from '../../lib/logger.ts';
import type { MailMessage, Mailer } from '../../lib/mailer.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';

type Writer = Pick<PrismaClient, 'emailOutbox'>;

export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];

/**
 * Durable outgoing-email queue (FR-160). Bulk mail such as invitations is queued in the database
 * (inside the same transaction as the change that caused it), then sent by an in-process worker
 * at a limited rate so the Titan mailbox isn't flooded. Failures are retried with back-off and the
 * delivery status (queued / sent / failed) is visible to organisers.
 */
export class OutboxService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly mailer: Mailer,
    private readonly logger: Logger,
    private readonly ratePerMinute: number,
  ) {}

  async enqueue(
    message: MailMessage & { toName?: string },
    meta: { kind: string; eventId?: string; invitationId?: string },
    client: Writer = this.prisma,
  ): Promise<db.EmailOutbox> {
    return client.emailOutbox.create({
      data: {
        kind: meta.kind,
        toEmail: message.to,
        toName: message.toName ?? null,
        subject: message.subject,
        text: message.text,
        html: message.html,
        eventId: meta.eventId ?? null,
        invitationId: meta.invitationId ?? null,
      },
    });
  }

  /** Sends what's due, within the per-minute rate limit. Safe to call repeatedly. */
  async processBatch(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const sentLastMinute = await this.prisma.emailOutbox.count({ where: { status: 'SENT', sentAt: { gt: new Date(now.getTime() - 60_000) } } });
    const budget = Math.max(0, this.ratePerMinute - sentLastMinute);
    if (budget === 0) return { sent: 0, failed: 0 };

    const due = await this.prisma.emailOutbox.findMany({
      where: { status: 'QUEUED', nextAttemptAt: { lte: now } },
      orderBy: { createdAt: 'asc' },
      take: budget,
    });

    let sent = 0;
    let failed = 0;
    for (const job of due) {
      // Claim the job so two workers can't send it twice.
      const claimed = await this.prisma.emailOutbox.updateMany({ where: { id: job.id, status: 'QUEUED' }, data: { status: 'SENDING' } });
      if (claimed.count !== 1) continue;
      try {
        await this.mailer.send({ to: job.toEmail, subject: job.subject, text: job.text, html: job.html });
        await this.prisma.emailOutbox.update({ where: { id: job.id }, data: { status: 'SENT', sentAt: new Date(), attempts: { increment: 1 }, lastError: null } });
        sent += 1;
      } catch (err) {
        const attempts = job.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await this.prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: giveUp ? 'FAILED' : 'QUEUED',
            attempts,
            lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
            nextAttemptAt: new Date(now.getTime() + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS.at(-1)!)),
          },
        });
        failed += 1;
        this.logger.warn({ jobId: job.id, attempts, giveUp }, 'outbox.send_failed');
      }
    }
    return { sent, failed };
  }

  /** Puts a failed email back in the queue (organiser "retry"). */
  async retry(id: string): Promise<void> {
    await this.prisma.emailOutbox.updateMany({ where: { id, status: 'FAILED' }, data: { status: 'QUEUED', attempts: 0, nextAttemptAt: new Date() } });
  }

  /** Background worker — not used in tests, which call processBatch() directly. */
  start(intervalMs = 5_000): () => void {
    // Anything stuck in SENDING from a crash is safe to retry.
    void this.prisma.emailOutbox.updateMany({ where: { status: 'SENDING' }, data: { status: 'QUEUED' } }).catch(() => undefined);
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await this.processBatch();
      } catch (err) {
        this.logger.error({ err }, 'outbox.worker_failed');
      } finally {
        running = false;
      }
    };
    const timer = setInterval(() => void tick(), intervalMs);
    timer.unref();
    void tick();
    return () => clearInterval(timer);
  }
}
