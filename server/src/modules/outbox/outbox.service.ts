import type { Logger } from '../../lib/logger.ts';
import type { MailMessage, Mailer } from '../../lib/mailer.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';

type Writer = Pick<PrismaClient, 'emailOutbox'>;

export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000];

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const message = err.message.trim();
    return message || `${err.name || 'Error'} (empty error message)`;
  }

  if (typeof err === 'string') {
    return err.trim() || 'Mailer threw an empty string error';
  }

  try {
    const serialized = JSON.stringify(err);
    return serialized && serialized !== '{}' ? serialized : 'Mailer threw a non-Error value with no details';
  } catch {
    return String(err) || 'Unknown mailer error';
  }
}

/**
 * Durable outgoing-email queue (FR-160). Bulk mail such as invitations is queued in the database
 * (inside the same transaction as the change that caused it), then sent by an in-process worker
 * at a limited rate. Failures are retried with back-off and the delivery status is visible to organisers.
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
    const sentLastMinute = await this.prisma.emailOutbox.count({
      where: {
        status: 'SENT',
        sentAt: { gt: new Date(now.getTime() - 60_000) },
      },
    });

    const budget = Math.max(0, this.ratePerMinute - sentLastMinute);
    if (budget === 0) {
      this.logger.info({ ratePerMinute: this.ratePerMinute }, 'outbox.rate_limit_reached');
      return { sent: 0, failed: 0 };
    }

    const due = await this.prisma.emailOutbox.findMany({
      where: {
        status: 'QUEUED',
        nextAttemptAt: { lte: now },
      },
      orderBy: { createdAt: 'asc' },
      take: budget,
    });

    if (due.length > 0) {
      this.logger.info({ dueCount: due.length, budget }, 'outbox.batch_started');
    }

    let sent = 0;
    let failed = 0;

    for (const job of due) {
      let claimed;
      try {
        claimed = await this.prisma.emailOutbox.updateMany({
          where: { id: job.id, status: 'QUEUED' },
          data: { status: 'SENDING' },
        });
      } catch (err) {
        this.logger.error(
          { jobId: job.id, error: describeError(err) },
          'outbox.claim_failed',
        );
        continue;
      }

      if (claimed.count !== 1) continue;

      this.logger.info(
        { jobId: job.id, kind: job.kind, attempt: job.attempts + 1 },
        'outbox.job_claimed',
      );

      try {
        this.logger.info({ jobId: job.id }, 'outbox.send_started');

        await this.mailer.send({
          to: job.toEmail,
          subject: job.subject,
          text: job.text,
          html: job.html,
        });
      } catch (err) {
        const attempts = job.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        const errorMessage = describeError(err).slice(0, 500);

        // Log before the database write so the gateway error is not lost if persistence fails.
        this.logger.warn(
          {
            jobId: job.id,
            kind: job.kind,
            attempts,
            giveUp,
            error: errorMessage,
          },
          'outbox.send_failed',
        );

        try {
          await this.prisma.emailOutbox.update({
            where: { id: job.id },
            data: {
              status: giveUp ? 'FAILED' : 'QUEUED',
              attempts,
              lastError: errorMessage,
              nextAttemptAt: new Date(
                now.getTime() + (BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]!),
              ),
            },
          });
          failed += 1;
        } catch (updateErr) {
          this.logger.error(
            {
              jobId: job.id,
              sendError: errorMessage,
              persistenceError: describeError(updateErr),
            },
            'outbox.status_update_failed',
          );
        }

        continue;
      }

      // Sending succeeded. Keep this DB update separate from the mailer try/catch:
      // if persistence fails, do not mark the email QUEUED and accidentally send it twice.
      try {
        await this.prisma.emailOutbox.update({
          where: { id: job.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            attempts: { increment: 1 },
            lastError: null,
          },
        });

        sent += 1;
        this.logger.info({ jobId: job.id }, 'outbox.send_succeeded');
      } catch (err) {
        this.logger.error(
          {
            jobId: job.id,
            error: describeError(err),
            note: 'Mailer reported success; record remains SENDING to avoid an automatic duplicate.',
          },
          'outbox.sent_status_update_failed',
        );
      }
    }

    this.logger.info({ sent, failed, processed: due.length }, 'outbox.batch_completed');
    return { sent, failed };
  }

  /** Puts a failed email back in the queue (organiser "retry"). */
  async retry(id: string): Promise<void> {
    await this.prisma.emailOutbox.updateMany({
      where: { id, status: 'FAILED' },
      data: {
        status: 'QUEUED',
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
      },
    });
  }

  /** Background worker — not used in tests, which call processBatch() directly. */
  start(intervalMs = 5_000): () => void {
    // Recover jobs left SENDING by a previous process. Log recovery errors instead of hiding them.
    const recovery = this.prisma.emailOutbox
      .updateMany({
        where: { status: 'SENDING' },
        data: { status: 'QUEUED' },
      })
      .then((result) => {
        if (result.count > 0) {
          this.logger.warn({ recoveredCount: result.count }, 'outbox.stale_jobs_requeued');
        }
      })
      .catch((err: unknown) => {
        this.logger.error(
          { error: describeError(err) },
          'outbox.startup_recovery_failed',
        );
      });

    let running = false;

    const tick = async () => {
      if (running) return;
      running = true;

      try {
        await recovery;
        await this.processBatch();
      } catch (err) {
        this.logger.error(
          { error: describeError(err) },
          'outbox.worker_failed',
        );
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
