import type { db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';

type Tx = db.Prisma.TransactionClient;

/**
 * Low-level, transaction-scoped operations on publication approval rounds. Shared by the
 * publication service (submit / approve / request changes), by event edits made while Pending
 * Approval (FR-228) and by membership changes, so every path follows the same rules:
 *
 *  - The approver set is a fixed snapshot of ACTIVE organisers taken when a round opens (FR-224).
 *  - Whoever opens a round counts as approving that version (agreed product rule).
 *  - Approvals bind to one event version; the event publishes only when every approver's latest
 *    decision is APPROVE for that same version (FR-225, FR-226).
 */

export async function openPublicationRound(
  tx: Tx,
  opts: { eventId: string; initiatorId: string; eventVersion: number; reason: string },
): Promise<{ roundId: string }> {
  const organisers = await tx.eventMembership.findMany({
    where: { eventId: opts.eventId, status: 'ACTIVE' },
    select: { userId: true },
  });
  const round = await tx.approvalRound.create({
    data: {
      eventId: opts.eventId,
      kind: 'PUBLICATION',
      eventVersion: opts.eventVersion,
      initiatedById: opts.initiatorId,
      reason: opts.reason,
      approvers: { create: organisers.map((o) => ({ userId: o.userId })) },
    },
  });
  if (organisers.some((o) => o.userId === opts.initiatorId)) {
    await tx.approvalDecision.create({
      data: { roundId: round.id, approverId: opts.initiatorId, decision: 'APPROVE', eventVersion: opts.eventVersion, comment: null },
    });
  }
  return { roundId: round.id };
}

export async function findOpenPublicationRound(tx: Tx, eventId: string) {
  return tx.approvalRound.findFirst({ where: { eventId, kind: 'PUBLICATION', status: 'OPEN' }, include: { approvers: true } });
}

/** Closes the open round (if any) as superseded — its approvals no longer count (FR-228). */
export async function supersedeOpenPublicationRound(tx: Tx, eventId: string): Promise<boolean> {
  const res = await tx.approvalRound.updateMany({
    where: { eventId, kind: 'PUBLICATION', status: 'OPEN' },
    data: { status: 'SUPERSEDED', closedAt: new Date() },
  });
  return res.count > 0;
}

/** True when every approver's latest decision in the round is APPROVE for the round's version. */
export async function isRoundFullyApproved(tx: Tx, roundId: string): Promise<boolean> {
  const round = await tx.approvalRound.findUniqueOrThrow({
    where: { id: roundId },
    include: { approvers: true, decisions: { orderBy: { createdAt: 'asc' } } },
  });
  if (round.approvers.length === 0) return false;
  const latest = new Map<string, (typeof round.decisions)[number]>();
  for (const d of round.decisions) latest.set(d.approverId, d);
  return round.approvers.every((a) => {
    const d = latest.get(a.userId);
    return d?.decision === 'APPROVE' && d.eventVersion === round.eventVersion;
  });
}

/**
 * If the round is fully approved, publishes the event (FR-015, FR-226) and closes the round.
 * The event row is updated conditionally on status + version, so a concurrent edit can't slip
 * an unapproved version through.
 */
export async function publishIfApproved(
  tx: Tx,
  audit: AuditService,
  opts: { eventId: string; roundId: string; actorId: string },
): Promise<boolean> {
  if (!(await isRoundFullyApproved(tx, opts.roundId))) return false;
  const round = await tx.approvalRound.findUniqueOrThrow({ where: { id: opts.roundId } });
  const published = await tx.event.updateMany({
    where: { id: opts.eventId, status: 'PENDING_APPROVAL', version: round.eventVersion },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  });
  if (published.count !== 1) return false;
  await tx.approvalRound.update({ where: { id: round.id }, data: { status: 'APPROVED', closedAt: new Date() } });
  await audit.record(
    {
      eventId: opts.eventId,
      actor: { type: 'USER', userId: opts.actorId },
      action: 'event.published',
      entityType: 'Event',
      entityId: opts.eventId,
      metadata: { roundId: round.id, eventVersion: round.eventVersion },
    },
    tx,
  );
  return true;
}

/**
 * Called inside an edit transaction when the event is Pending Approval: the old round's
 * approvals are invalidated and a new round opens for the new version (FR-228).
 */
export async function restartRoundAfterEdit(
  tx: Tx,
  audit: AuditService,
  opts: { eventId: string; editorId: string; newVersion: number },
): Promise<void> {
  await supersedeOpenPublicationRound(tx, opts.eventId);
  const { roundId } = await openPublicationRound(tx, {
    eventId: opts.eventId,
    initiatorId: opts.editorId,
    eventVersion: opts.newVersion,
    reason: 'Event edited while awaiting approval — previous approvals reset',
  });
  await audit.record(
    {
      eventId: opts.eventId,
      actor: { type: 'USER', userId: opts.editorId },
      action: 'publication.round_restarted',
      entityType: 'ApprovalRound',
      entityId: roundId,
      metadata: { eventVersion: opts.newVersion, reason: 'edited' },
    },
    tx,
  );
  await publishIfApproved(tx, audit, { eventId: opts.eventId, roundId, actorId: opts.editorId });
}
