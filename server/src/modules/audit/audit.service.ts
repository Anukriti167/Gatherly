import type { PrismaClient, db } from '../../lib/prisma.ts';

export type Actor = { type: 'USER'; userId: string } | { type: 'GUEST'; guestId: string } | { type: 'SYSTEM' };

export interface AuditEntry {
  eventId?: string;
  actor: Actor;
  action: string; // dotted verb, e.g. "event.created", "activity.updated", "cover.changed"
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Anything that exposes the auditLog delegate — the client itself or a transaction client. */
type AuditWriter = Pick<PrismaClient, 'auditLog'>;

const toJson = (value: unknown) =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as db.Prisma.InputJsonValue);

/**
 * Append-only audit trail (FR-197 – FR-199). Call inside the same transaction as the change
 * being recorded so the log can never disagree with the data.
 */
export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  async record(entry: AuditEntry, client: AuditWriter = this.prisma): Promise<void> {
    await client.auditLog.create({
      data: {
        eventId: entry.eventId,
        actorType: entry.actor.type,
        actorUserId: entry.actor.type === 'USER' ? entry.actor.userId : undefined,
        actorGuestId: entry.actor.type === 'GUEST' ? entry.actor.guestId : undefined,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: toJson(entry.before),
        after: toJson(entry.after),
        metadata: toJson(entry.metadata),
      },
    });
  }
}
