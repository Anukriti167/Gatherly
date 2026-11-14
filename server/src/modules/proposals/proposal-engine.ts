import { proposalChangeSchema, type ProposalChange } from '@gatherly/shared';
import { z } from 'zod';
import type { db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { revokeGuestAccess } from '../invitations/invitations.service.ts';

type Tx = db.Prisma.TransactionClient;

export const parseChanges = (json: unknown): ProposalChange[] => z.array(proposalChangeSchema).parse(json);

/** True when every required approver's latest decision is APPROVE for the proposal's current version. */
export async function isUnanimous(tx: Tx, proposalId: string): Promise<boolean> {
  const p = await tx.changeProposal.findUniqueOrThrow({
    where: { id: proposalId },
    include: { approvers: true, decisions: { orderBy: { createdAt: 'asc' } } },
  });
  if (p.status !== 'OPEN' || p.approvers.length === 0) return false;
  const latest = new Map<string, (typeof p.decisions)[number]>();
  for (const d of p.decisions) if (d.proposalVersion === p.version) latest.set(d.approverId, d);
  return p.approvers.every((a) => latest.get(a.userId)?.decision === 'APPROVE');
}

/** Closes every other open proposal on the event (used when the event leaves Published). */
async function closeOtherOpenProposals(tx: Tx, eventId: string, exceptId: string, reason: string): Promise<void> {
  await tx.changeProposal.updateMany({
    where: { eventId, status: 'OPEN', id: { not: exceptId } },
    data: { status: 'CLOSED', closedAt: new Date(), closedReason: reason },
  });
}

/**
 * If the proposal is unanimously approved for its current version, applies its changes atomically
 * (FR-144, FR-145) and marks it APPLIED. Returns true when applied.
 */
export async function applyIfUnanimous(tx: Tx, audit: AuditService, opts: { proposalId: string; actorId: string }): Promise<boolean> {
  if (!(await isUnanimous(tx, opts.proposalId))) return false;
  const p = await tx.changeProposal.findUniqueOrThrow({
    where: { id: opts.proposalId },
    include: { revisions: { orderBy: { version: 'desc' }, take: 1 }, event: true },
  });
  const changes = parseChanges(p.revisions[0]!.changes);
  const eventId = p.eventId;

  // The event must still be published; otherwise this proposal no longer applies.
  if (p.event.status !== 'PUBLISHED') {
    await tx.changeProposal.update({ where: { id: p.id }, data: { status: 'CLOSED', closedAt: new Date(), closedReason: 'The event is no longer published' } });
    return false;
  }

  const actor = { type: 'USER' as const, userId: opts.actorId };
  const meta = { proposalId: p.id, proposalVersion: p.version };

  for (const change of changes) {
    switch (change.type) {
      case 'REMOVE_GUESTS': {
        const guests = await tx.guest.findMany({ where: { eventId, id: { in: change.guestIds }, removedAt: null } });
        for (const g of guests) {
          await tx.guestActivityAssignment.deleteMany({ where: { guestId: g.id } });
          await tx.guest.update({ where: { id: g.id }, data: { removedAt: new Date() } });
          await revokeGuestAccess(tx, g.id, opts.actorId); // FR-203
          await audit.record(
            { eventId, actor, action: 'guest.removed', entityType: 'Guest', entityId: g.id, before: { name: g.name, email: g.email }, metadata: meta },
            tx,
          );
        }
        break;
      }
      case 'UNPUBLISH': {
        await tx.event.update({ where: { id: eventId }, data: { status: 'DRAFT', publishedAt: null, version: { increment: 1 } } });
        await closeOtherOpenProposals(tx, eventId, p.id, 'The event was unpublished');
        await audit.record({ eventId, actor, action: 'event.unpublished', entityType: 'Event', entityId: eventId, metadata: meta }, tx);
        break;
      }
      case 'COMPLETE_EVENT': {
        // Finished early: activities that started are completed; ones that never started didn't happen.
        const now = new Date();
        await tx.activity.updateMany({ where: { eventId, status: 'SCHEDULED', startsAt: { lte: now } }, data: { status: 'COMPLETED' } });
        await tx.activity.updateMany({ where: { eventId, status: 'SCHEDULED', startsAt: { gt: now } }, data: { status: 'CANCELLED', cancelledAt: now } });
        await tx.event.update({ where: { id: eventId }, data: { status: 'COMPLETED', completedAt: now, version: { increment: 1 } } });
        await closeOtherOpenProposals(tx, eventId, p.id, 'The event was marked as completed');
        await audit.record({ eventId, actor, action: 'event.completed', entityType: 'Event', entityId: eventId, metadata: { ...meta, reason: 'early' } }, tx);
        break;
      }
      case 'CANCEL_EVENT': {
        const now = new Date();
        await tx.event.update({ where: { id: eventId }, data: { status: 'CANCELLED', cancelledAt: now, version: { increment: 1 } } });
        await tx.activity.updateMany({ where: { eventId, status: 'SCHEDULED' }, data: { status: 'CANCELLED', cancelledAt: now } });
        await closeOtherOpenProposals(tx, eventId, p.id, 'The event was cancelled');
        await audit.record(
          { eventId, actor, action: 'event.cancelled', entityType: 'Event', entityId: eventId, metadata: { ...meta, reason: change.reason ?? null } },
          tx,
        );
        break;
      }
    }
  }

  await tx.changeProposal.update({ where: { id: p.id }, data: { status: 'APPLIED', closedAt: new Date() } });
  await audit.record({ eventId, actor, action: 'proposal.applied', entityType: 'ChangeProposal', entityId: p.id, metadata: meta }, tx);
  return true;
}

/**
 * An organiser who is removed can no longer approve. Their approval stops being required on open
 * proposals so those can't stall forever; any proposal that becomes unanimous is applied.
 * Returns ids of proposals that were applied as a result.
 */
export async function dropApproverFromOpenProposals(tx: Tx, audit: AuditService, opts: { eventId: string; userId: string; actorId: string }): Promise<string[]> {
  const open = await tx.changeProposal.findMany({
    where: { eventId: opts.eventId, status: 'OPEN', approvers: { some: { userId: opts.userId } } },
    select: { id: true },
  });
  const applied: string[] = [];
  for (const { id } of open) {
    await tx.proposalApprover.delete({ where: { proposalId_userId: { proposalId: id, userId: opts.userId } } });
    if (await applyIfUnanimous(tx, audit, { proposalId: id, actorId: opts.actorId })) applied.push(id);
  }
  return applied;
}
