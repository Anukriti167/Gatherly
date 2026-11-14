import {
  googleMapsUrl,
  utcToZonedLocal,
  type ActivityDetail,
  type CreateActivityData,
  type UpdateActivityData,
} from '@gatherly/shared';
import { badRequest, notFound } from '../../lib/errors.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { diffFields, toUtc, type EventsService } from '../events/events.service.ts';

/** Children loaded with every activity, already in display order. */
const withChildren = {
  itinerary: { orderBy: [{ startsAt: 'asc' }, { position: 'asc' }] },
  menuCategories: { orderBy: { position: 'asc' }, include: { items: { orderBy: { position: 'asc' } } } },
  people: { orderBy: { sortOrder: 'asc' } },
} satisfies db.Prisma.ActivityInclude;

type ActivityRow = db.Prisma.ActivityGetPayload<{ include: typeof withChildren }>;

const tagsOf = (json: unknown): string[] => (Array.isArray(json) ? json.filter((t): t is string => typeof t === 'string') : []);

/** Compact, human-readable snapshot of the nested sections for the audit trail. */
function childrenSummary(a: ActivityRow) {
  return {
    itinerary: a.itinerary.map((i) => `${utcToZonedLocal(i.startsAt, a.timezone).slice(11)} ${i.title}`),
    menu: a.menuCategories.map((c) => `${c.name}: ${c.items.map((i) => i.name).join(', ')}`),
    people: a.people.map((p) => `${p.role.toLowerCase()}: ${p.name}`),
  };
}

export function toActivityDetail(a: ActivityRow): ActivityDetail {
  return {
    id: a.id,
    eventId: a.eventId,
    name: a.name,
    description: a.description,
    status: a.status,
    timezone: a.timezone,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    startsAtLocal: utcToZonedLocal(a.startsAt, a.timezone),
    endsAtLocal: utcToZonedLocal(a.endsAt, a.timezone),
    sortOrder: a.sortOrder,
    venueName: a.venueName,
    venueAddress: a.venueAddress,
    venueLatitude: a.venueLatitude,
    venueLongitude: a.venueLongitude,
    virtualMeetingUrl: a.virtualMeetingUrl,
    mapsUrl: googleMapsUrl(a),
    capacity: a.capacity,
    rsvpDeadline: a.rsvpDeadline?.toISOString() ?? null,
    rsvpDeadlineLocal: a.rsvpDeadline ? utcToZonedLocal(a.rsvpDeadline, a.timezone) : null,
    dressCode: a.dressCode,
    themeDescription: a.themeDescription,
    themeColors: Array.isArray(a.themeColors) ? (a.themeColors as string[]) : [],
    instructions: a.instructions,
    showPeople: a.showPeople,
    showItinerary: a.showItinerary,
    showMenu: a.showMenu,
    showDressCode: a.showDressCode,
    showTheme: a.showTheme,
    showInstructions: a.showInstructions,
    itinerary: a.itinerary.map((i) => ({
      id: i.id,
      title: i.title,
      description: i.description,
      startsAt: i.startsAt.toISOString(),
      endsAt: i.endsAt?.toISOString() ?? null,
      startsAtLocal: utcToZonedLocal(i.startsAt, a.timezone),
      endsAtLocal: i.endsAt ? utcToZonedLocal(i.endsAt, a.timezone) : null,
    })),
    menu: a.menuCategories.map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items.map((i) => ({ id: i.id, name: i.name, description: i.description, dietaryTags: tagsOf(i.dietaryTags) })),
    })),
    people: a.people.map((p) => ({ id: p.id, role: p.role, name: p.name, title: p.title, bio: p.bio })),
  };
}

const AUDITED_FIELDS = [
  'name',
  'description',
  'timezone',
  'startsAt',
  'endsAt',
  'venueName',
  'venueAddress',
  'venueLatitude',
  'venueLongitude',
  'virtualMeetingUrl',
  'capacity',
  'rsvpDeadline',
  'dressCode',
  'themeDescription',
  'themeColors',
  'instructions',
  'showPeople',
  'showItinerary',
  'showMenu',
  'showDressCode',
  'showTheme',
  'showInstructions',
] as const;

/** Simple optional fields copied as-is when present in the input. */
const PLAIN_FIELDS = [
  'name',
  'description',
  'venueName',
  'venueAddress',
  'venueLatitude',
  'venueLongitude',
  'virtualMeetingUrl',
  'capacity',
  'dressCode',
  'themeDescription',
  'instructions',
  'showPeople',
  'showItinerary',
  'showMenu',
  'showDressCode',
  'showTheme',
  'showInstructions',
] as const;

/**
 * Activities belong to one event (FR-012) and are edited independently of each other (FR-036).
 * All writes go through EventsService.runEdit, so they're limited to Draft / Pending Approval,
 * bump the event version, and are audited (FR-199).
 */
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
  ) {}

  async list(eventId: string, userId: string): Promise<ActivityDetail[]> {
    await this.events.authorize(eventId, userId, 'event.view');
    const rows = await this.prisma.activity.findMany({
      where: { eventId },
      include: withChildren,
      orderBy: [{ startsAt: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toActivityDetail);
  }

  async get(eventId: string, activityId: string, userId: string): Promise<ActivityDetail> {
    await this.events.authorize(eventId, userId, 'event.view');
    return toActivityDetail(await this.findInEvent(this.prisma, eventId, activityId));
  }

  /** FR-012, FR-013 */
  async create(eventId: string, userId: string, input: CreateActivityData, expectedVersion?: number): Promise<ActivityDetail> {
    const times = this.resolveTimes(input.startsAt, input.endsAt, input.timezone, input.rsvpDeadline);

    return this.events.runEdit(eventId, userId, expectedVersion, async (tx) => {
      const last = await tx.activity.aggregate({ where: { eventId }, _max: { sortOrder: true } });
      const data = this.pickPlain(input);
      const created = await tx.activity.create({
        data: {
          ...data,
          name: input.name,
          eventId,
          ...times,
          themeColors: input.themeColors ?? undefined,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
      await this.replaceChildren(tx, created.id, times.timezone, input);
      const full = await tx.activity.findUniqueOrThrow({ where: { id: created.id }, include: withChildren });
      await this.audit.record(
        {
          eventId,
          actor: { type: 'USER', userId },
          action: 'activity.created',
          entityType: 'Activity',
          entityId: created.id,
          after: { name: full.name, startsAt: full.startsAt, endsAt: full.endsAt, timezone: full.timezone, ...childrenSummary(full) },
        },
        tx,
      );
      return toActivityDetail(full);
    });
  }

  /** FR-013, FR-036 */
  async update(
    eventId: string,
    activityId: string,
    userId: string,
    input: UpdateActivityData,
    expectedVersion?: number,
  ): Promise<ActivityDetail> {
    return this.events.runEdit(eventId, userId, expectedVersion, async (tx) => {
      const current = await this.findInEvent(tx, eventId, activityId);
      const data: Record<string, unknown> = this.pickPlain(input);
      if (input.themeColors !== undefined) data['themeColors'] = input.themeColors;

      // Times: a new start/end/timezone set, or just a new RSVP deadline against existing times.
      const timezone = input.timezone ?? current.timezone;
      if (input.startsAt !== undefined && input.endsAt !== undefined) {
        const deadline = input.rsvpDeadline !== undefined ? input.rsvpDeadline : current.rsvpDeadline ? utcToZonedLocal(current.rsvpDeadline, timezone) : null;
        Object.assign(data, this.resolveTimes(input.startsAt, input.endsAt, timezone, deadline));
      } else if (input.rsvpDeadline !== undefined) {
        const startsAtLocal = utcToZonedLocal(current.startsAt, timezone);
        const endsAtLocal = utcToZonedLocal(current.endsAt, timezone);
        data['rsvpDeadline'] = this.resolveTimes(startsAtLocal, endsAtLocal, timezone, input.rsvpDeadline).rsvpDeadline;
      }

      const { before, after } = diffFields(current, data, AUDITED_FIELDS);
      await tx.activity.update({ where: { id: activityId }, data: data as db.Prisma.ActivityUpdateInput });
      await this.replaceChildren(tx, activityId, timezone, input);
      const updated = await tx.activity.findUniqueOrThrow({ where: { id: activityId }, include: withChildren });

      // Nested sections are audited as readable summaries, only when they changed.
      const sections = diffFields(childrenSummary(current), childrenSummary(updated), ['itinerary', 'menu', 'people']);
      Object.assign(before, sections.before);
      Object.assign(after, sections.after);
      if (Object.keys(after).length > 0) {
        await this.audit.record(
          { eventId, actor: { type: 'USER', userId }, action: 'activity.updated', entityType: 'Activity', entityId: activityId, before, after },
          tx,
        );
      }
      return toActivityDetail(updated);
    });
  }

  /**
   * Replaces itinerary / menu / people when the corresponding list is present in the input
   * (array order = display order). Omitted lists are left untouched.
   */
  private async replaceChildren(
    tx: db.Prisma.TransactionClient,
    activityId: string,
    timezone: string,
    input: Pick<UpdateActivityData, 'itinerary' | 'menu' | 'people'>,
  ): Promise<void> {
    if (input.itinerary) {
      const rows = input.itinerary.map((item, i) => {
        const startsAt = toUtc(item.startsAt, timezone, `itinerary.${i}.startsAt`);
        const endsAt = item.endsAt ? toUtc(item.endsAt, timezone, `itinerary.${i}.endsAt`) : null;
        if (endsAt && endsAt <= startsAt) {
          throw badRequest('Please check the itinerary', { [`itinerary.${i}.endsAt`]: ['End must be after the start'] });
        }
        return { activityId, title: item.title, description: item.description ?? null, startsAt, endsAt, position: i };
      });
      await tx.itineraryItem.deleteMany({ where: { activityId } });
      if (rows.length) await tx.itineraryItem.createMany({ data: rows });
    }

    if (input.menu) {
      await tx.menuCategory.deleteMany({ where: { activityId } }); // items cascade
      for (const [position, category] of input.menu.entries()) {
        await tx.menuCategory.create({
          data: {
            activityId,
            name: category.name,
            position,
            items: {
              create: category.items.map((item, i) => ({
                name: item.name,
                description: item.description ?? null,
                dietaryTags: item.dietaryTags,
                position: i,
              })),
            },
          },
        });
      }
    }

    if (input.people) {
      await tx.activityPerson.deleteMany({ where: { activityId } });
      if (input.people.length) {
        await tx.activityPerson.createMany({
          data: input.people.map((p, i) => ({ activityId, role: p.role, name: p.name, title: p.title ?? null, bio: p.bio ?? null, sortOrder: i })),
        });
      }
    }
  }

  /**
   * FR-013 — removing an activity is only possible before publication. (Cancelling an activity
   * of a published event is a change proposal, FR-152.)
   */
  async remove(eventId: string, activityId: string, userId: string, expectedVersion?: number): Promise<void> {
    await this.events.runEdit(eventId, userId, expectedVersion, async (tx) => {
      const current = await this.findInEvent(tx, eventId, activityId);
      await tx.activity.delete({ where: { id: activityId } });
      await this.audit.record(
        {
          eventId,
          actor: { type: 'USER', userId },
          action: 'activity.deleted',
          entityType: 'Activity',
          entityId: activityId,
          before: { name: current.name, startsAt: current.startsAt, endsAt: current.endsAt },
        },
        tx,
      );
    });
  }

  /** Scoped lookup — an activity id from another event is "not found" (no cross-event access). */
  private async findInEvent(client: Pick<PrismaClient, 'activity'>, eventId: string, activityId: string): Promise<ActivityRow> {
    const activity = await client.activity.findFirst({ where: { id: activityId, eventId }, include: withChildren });
    if (!activity) throw notFound('Activity not found');
    return activity;
  }

  private pickPlain(input: Partial<Record<(typeof PLAIN_FIELDS)[number], unknown>>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of PLAIN_FIELDS) if (input[f] !== undefined) out[f] = input[f];
    return out;
  }

  private resolveTimes(startsAtLocal: string, endsAtLocal: string, timezone: string, rsvpDeadlineLocal: string | null | undefined) {
    const startsAt = toUtc(startsAtLocal, timezone, 'startsAt');
    const endsAt = toUtc(endsAtLocal, timezone, 'endsAt');
    if (endsAt <= startsAt) throw badRequest('Please check the highlighted fields', { endsAt: ['End must be after the start'] });
    const rsvpDeadline = rsvpDeadlineLocal ? toUtc(rsvpDeadlineLocal, timezone, 'rsvpDeadline') : null;
    if (rsvpDeadline && rsvpDeadline > startsAt) {
      throw badRequest('Please check the highlighted fields', { rsvpDeadline: ['RSVP deadline must be before the activity starts'] });
    }
    return { timezone, startsAt, endsAt, rsvpDeadline };
  }
}
