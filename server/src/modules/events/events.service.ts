import {
  allowedActions,
  can,
  timeframeOf,
  utcToZonedLocal,
  zonedLocalToUtc,
  type CreateEventData,
  type EventAction,
  type EventDetail,
  type EventSummary,
  type MembershipRole,
  type UpdateEventData,
} from '@gatherly/shared';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { restartRoundAfterEdit } from '../publication/approval-rounds.ts';

type EventRow = db.Event;

/** Converts organiser wall-clock input to UTC, with a field-level error if it can't. */
export function toUtc(local: string, timezone: string, field: string): Date {
  const date = zonedLocalToUtc(local, timezone);
  if (!date) throw badRequest('Please check the highlighted fields', { [field]: ['This time does not exist in the selected timezone'] });
  return date;
}

function toSummary(event: EventRow, role: MembershipRole | 'GUEST'): EventSummary {
  return {
    id: event.id,
    name: event.name,
    eventType: event.eventType,
    customTypeLabel: event.customTypeLabel,
    status: event.status,
    timezone: event.timezone,
    startsAt: event.startsAt.toISOString(),
    endsAt: event.endsAt.toISOString(),
    role,
    timeframe: timeframeOf(event.startsAt, event.endsAt, new Date(), event.status),
  };
}

function toDetail(event: EventRow, role: MembershipRole): EventDetail {
  return {
    ...toSummary(event, role),
    role, // organisers only — detail is never built for guests
    description: event.description,
    planningPath: event.planningPath,
    version: event.version,
    startsAtLocal: utcToZonedLocal(event.startsAt, event.timezone),
    endsAtLocal: utcToZonedLocal(event.endsAt, event.timezone),
    instructions: event.instructions,
    organiserContactName: event.organiserContactName,
    organiserContactEmail: event.organiserContactEmail,
    organiserContactPhone: event.organiserContactPhone,
    guestUploadsEnabled: event.guestUploadsEnabled,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
    allowedActions: allowedActions(role, event.status),
  };
}

/** Fields compared for the audit trail "before/after" on updates. */
const AUDITED_FIELDS = [
  'name',
  'description',
  'eventType',
  'customTypeLabel',
  'planningPath',
  'timezone',
  'startsAt',
  'endsAt',
  'instructions',
  'organiserContactName',
  'organiserContactEmail',
  'organiserContactPhone',
  'guestUploadsEnabled',
] as const;

export class EventsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {}

  /**
   * Loads an event and the caller's ACTIVE role. Non-members get 404 — not 403 — so the
   * existence of private events isn't revealed (FR-108, FR-200).
   */
  async loadForMember(eventId: string, userId: string): Promise<{ event: EventRow; role: MembershipRole }> {
    const membership = await this.prisma.eventMembership.findUnique({
      where: { eventId_userId: { eventId, userId } },
      include: { event: true },
    });
    if (!membership || membership.status !== 'ACTIVE') throw notFound('Event not found');
    return { event: membership.event, role: membership.role };
  }

  /** Loads the event and asserts the caller may perform `action` in its current status. */
  async authorize(eventId: string, userId: string, action: EventAction) {
    const ctx = await this.loadForMember(eventId, userId);
    if (!can(ctx.role, action, ctx.event.status)) {
      throw forbidden(
        ctx.event.status === 'PUBLISHED' && action === 'event.edit'
          ? 'This event is published. Changes must go through a change proposal approved by all organisers.'
          : 'You do not have permission to do that for this event right now',
      );
    }
    return ctx;
  }

  /** FR-008, FR-009, FR-014, FR-060 — creator becomes the single owner; event starts as Draft. */
  async create(userId: string, input: CreateEventData): Promise<EventDetail> {
    const startsAt = toUtc(input.startsAt, input.timezone, 'startsAt');
    const endsAt = toUtc(input.endsAt, input.timezone, 'endsAt');
    if (endsAt <= startsAt) throw badRequest('Please check the highlighted fields', { endsAt: ['End must be after the start'] });

    const event = await this.prisma.$transaction(async (tx) => {
      const created = await tx.event.create({
        data: {
          name: input.name,
          description: input.description ?? '',
          eventType: input.eventType,
          customTypeLabel: input.customTypeLabel ?? null,
          planningPath: input.planningPath ?? null,
          timezone: input.timezone,
          startsAt,
          endsAt,
          createdById: userId,
          memberships: { create: { userId, role: 'OWNER', status: 'ACTIVE', respondedAt: new Date() } },
        },
      });
      await this.audit.record(
        {
          eventId: created.id,
          actor: { type: 'USER', userId },
          action: 'event.created',
          entityType: 'Event',
          entityId: created.id,
          after: { name: created.name, eventType: created.eventType, startsAt, endsAt, timezone: created.timezone },
        },
        tx,
      );
      return created;
    });
    return toDetail(event, 'OWNER');
  }

  async get(eventId: string, userId: string): Promise<EventDetail> {
    const { event, role } = await this.authorize(eventId, userId, 'event.view');
    return toDetail(event, role);
  }

  /**
   * FR-006: events the user owns or co-administers. (Events they're invited to / attended are
   * added once guest records can be linked to accounts.)
   */
  async listForUser(userId: string): Promise<EventSummary[]> {
    const memberships = await this.prisma.eventMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      include: { event: true },
      orderBy: { event: { startsAt: 'asc' } },
    });
    const organised = memberships.map((m) => toSummary(m.event, m.role));
    const invited = await this.invitedEventsFor(userId, new Set(memberships.map((m) => m.eventId)));
    return [...organised, ...invited].sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
  }

  /**
   * FR-006 — events the user is invited to as a guest, matched on their account email.
   * Only for VERIFIED emails, so nobody can see someone else's invitation by signing up with their
   * address. FR-180: a completed event counts as history only with at least one confirmed RSVP.
   */
  private async invitedEventsFor(userId: string, organisedIds: Set<string>): Promise<EventSummary[]> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!user.emailVerifiedAt) return [];
    const guests = await this.prisma.guest.findMany({
      where: {
        email: user.email,
        removedAt: null,
        invitation: { status: 'ACTIVE', lastSentAt: { not: null } },
        event: { status: { in: ['PUBLISHED', 'COMPLETED', 'CANCELLED'] } },
      },
      include: { event: true, rsvps: { where: { status: 'CONFIRMED' }, select: { id: true } } },
    });
    return guests
      .filter((g) => !organisedIds.has(g.eventId))
      .filter((g) => g.event.status !== 'COMPLETED' || g.rsvps.length > 0)
      .map((g) => toSummary(g.event, 'GUEST'));
  }

  /**
   * Direct edit of event details — allowed in Draft and Pending Approval only (FR-013, FR-221).
   * Every edit bumps `version`; in Pending Approval that invalidates the current approval round
   * (FR-228 — wired up when the publication workflow lands).
   */
  async update(eventId: string, userId: string, input: UpdateEventData, expectedVersion?: number): Promise<EventDetail> {
    const { event, role } = await this.authorize(eventId, userId, 'event.edit');

    const timezone = input.timezone ?? event.timezone;
    const data: db.Prisma.EventUpdateInput = {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.eventType !== undefined && { eventType: input.eventType }),
      ...(input.customTypeLabel !== undefined && { customTypeLabel: input.customTypeLabel }),
      ...(input.planningPath !== undefined && { planningPath: input.planningPath }),
      ...(input.instructions !== undefined && { instructions: input.instructions }),
      ...(input.organiserContactName !== undefined && { organiserContactName: input.organiserContactName }),
      ...(input.organiserContactEmail !== undefined && { organiserContactEmail: input.organiserContactEmail }),
      ...(input.organiserContactPhone !== undefined && { organiserContactPhone: input.organiserContactPhone }),
      ...(input.guestUploadsEnabled !== undefined && { guestUploadsEnabled: input.guestUploadsEnabled }),
    };
    if (input.startsAt !== undefined && input.endsAt !== undefined) {
      const startsAt = toUtc(input.startsAt, timezone, 'startsAt');
      const endsAt = toUtc(input.endsAt, timezone, 'endsAt');
      if (endsAt <= startsAt) throw badRequest('Please check the highlighted fields', { endsAt: ['End must be after the start'] });
      Object.assign(data, { timezone, startsAt, endsAt });
    }

    const { before, after } = diffFields(event, data as Record<string, unknown>, AUDITED_FIELDS);
    if (Object.keys(after).length === 0) {
      assertVersion(event.version, expectedVersion);
      return toDetail(event, role);
    }

    const updated = await this.runEdit(eventId, userId, expectedVersion, async (tx, ctx) => {
      await tx.event.update({ where: { id: eventId }, data });
      await this.audit.record(
        {
          eventId,
          actor: { type: 'USER', userId },
          action: 'event.updated',
          entityType: 'Event',
          entityId: eventId,
          before,
          after,
          metadata: { fromVersion: ctx.event.version, status: ctx.event.status },
        },
        tx,
      );
      return tx.event.findUniqueOrThrow({ where: { id: eventId } });
    });
    return toDetail(updated, role);
  }

  /**
   * The one path for every direct edit of an event or anything inside it (details, activities,
   * itinerary, menus…). In a single transaction it:
   *   1. authorises `event.edit` (Draft / Pending Approval only — published events use proposals),
   *   2. bumps the event version, but only if it still equals the version the editor started
   *      from (optimistic concurrency; the row lock also serialises concurrent edits),
   *   3. runs `apply`.
   * Because every change bumps the version, approvals — which bind to a version — are
   * automatically invalidated by any edit (FR-143, FR-228).
   */
  async runEdit<T>(
    eventId: string,
    userId: string,
    expectedVersion: number | undefined,
    apply: (tx: db.Prisma.TransactionClient, ctx: { event: EventRow; role: MembershipRole }) => Promise<T>,
  ): Promise<T> {
    const ctx = await this.authorize(eventId, userId, 'event.edit');
    assertVersion(ctx.event.version, expectedVersion);

    return this.prisma.$transaction(async (tx) => {
      const bumped = await tx.event.updateMany({
        where: { id: eventId, version: ctx.event.version },
        data: { version: { increment: 1 } },
      });
      if (bumped.count !== 1) throw staleVersion();
      const result = await apply(tx, ctx);
      if (ctx.event.status === 'PENDING_APPROVAL') {
        // FR-228: editing while awaiting approval resets approvals and starts a new round.
        await restartRoundAfterEdit(tx, this.audit, { eventId, editorId: userId, newVersion: ctx.event.version + 1 });
      }
      return result;
    });
  }
}

function staleVersion(): AppError {
  return new AppError(409, 'STALE_VERSION', 'This event was changed by someone else. Reload to see the latest version.');
}

function assertVersion(actual: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== actual) throw staleVersion();
}

/** Compares `next` against `current` for the listed fields; returns only what changed. */
export function diffFields(
  current: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly string[],
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field in next)) continue;
    const a = current[field];
    const b = next[field];
    const same =
      a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    if (!same) {
      before[field] = a;
      after[field] = b;
    }
  }
  return { before, after };
}
