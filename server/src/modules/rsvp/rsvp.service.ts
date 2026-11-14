import type { RsvpOverview } from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { AppError, notFound } from '../../lib/errors.ts';
import { buildIcs } from '../../lib/ics.ts';
import { emailLayout } from '../../lib/mailer.ts';
import type { PrismaClient } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { EventsService } from '../events/events.service.ts';
import type { GuestContext } from '../guest-portal/guest-access.service.ts';
import type { NotificationsService } from '../notifications/notifications.service.ts';
import type { OutboxService } from '../outbox/outbox.service.ts';

const closed = (message: string) => new AppError(409, 'RSVP_CLOSED', message);
const fmt = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);

/** Per-activity RSVPs (FR-109 – FR-119) and calendar export (FR-190, FR-191). */
export class RsvpService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly notifier: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  /** The guest's activities (all, or their explicit assignments) — the only ones they can touch. */
  private async assignedActivity(ctx: GuestContext, activityId: string) {
    const guest = await this.prisma.guest.findUniqueOrThrow({ where: { id: ctx.guestId }, include: { assignments: true, event: true } });
    const activity = await this.prisma.activity.findFirst({ where: { id: activityId, eventId: guest.eventId } });
    const assigned = guest.allActivities || guest.assignments.some((a) => a.activityId === activityId);
    // FR-114: not assigned looks exactly like "doesn't exist".
    if (!activity || !assigned) throw notFound('Activity not found');
    return { guest, activity };
  }

  /** FR-109, FR-111, FR-113, FR-114, FR-119 — answer or change an answer before the deadline. */
  async respond(ctx: GuestContext, activityId: string, status: 'CONFIRMED' | 'DECLINED'): Promise<void> {
    const { guest, activity } = await this.assignedActivity(ctx, activityId);
    const now = new Date();
    if (guest.event.status !== 'PUBLISHED') throw closed('RSVPs are closed for this event.');
    if (activity.status !== 'SCHEDULED') throw closed('This activity has been cancelled or has already happened.');
    if (activity.startsAt <= now) throw closed('This activity has already started.');
    if (activity.rsvpDeadline && activity.rsvpDeadline <= now) throw closed('The RSVP deadline for this activity has passed. Please contact the organisers.');

    const previous = await this.prisma.$transaction(async (tx) => {
      // Lock the activity row so two guests can't both take the last seat (FR-022).
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${activityId} FOR UPDATE`;
      const before = await tx.rsvp.findUnique({ where: { guestId_activityId: { guestId: guest.id, activityId } } });
      if (before?.status === status) return before.status;

      if (status === 'CONFIRMED' && activity.capacity !== null) {
        const taken = await tx.rsvp.count({ where: { activityId, status: 'CONFIRMED', guestId: { not: guest.id } } });
        if (taken >= activity.capacity) throw new AppError(409, 'ACTIVITY_FULL', 'Sorry — this activity is full. Please contact the organisers.');
      }
      await tx.rsvp.upsert({
        where: { guestId_activityId: { guestId: guest.id, activityId } },
        create: { guestId: guest.id, activityId, status, respondedAt: now },
        update: { status, respondedAt: now },
      });
      await this.audit.record(
        {
          eventId: guest.eventId,
          actor: { type: 'GUEST', guestId: guest.id },
          action: 'rsvp.updated',
          entityType: 'Activity',
          entityId: activityId,
          before: { status: before?.status ?? 'PENDING' },
          after: { status },
          metadata: { activityName: activity.name, guestName: guest.name },
        },
        tx,
      );
      // FR-117 — confirmation email to the guest, via the queue.
      const going = status === 'CONFIRMED';
      const paragraphs = [
        `Hi ${guest.name},`,
        going ? `You're confirmed for ${activity.name} on ${fmt(activity.startsAt, activity.timezone)}. See you there!` : `Thanks for letting us know you can't make it to ${activity.name}.`,
        'You can change your answer from your invitation page until the RSVP deadline.',
      ];
      await this.outbox.enqueue(
        {
          to: guest.email,
          toName: guest.name,
          subject: going ? `Confirmed: ${activity.name} · ${guest.event.name}` : `RSVP received: ${activity.name} · ${guest.event.name}`,
          text: paragraphs.join('\n\n'),
          html: emailLayout({ heading: going ? "You're going! 🎉" : 'RSVP received', paragraphs }),
        },
        { kind: 'rsvp.confirmation', eventId: guest.eventId },
        tx,
      );
      return before?.status ?? 'PENDING';
    });
    if (previous === status) return;

    // FR-118 — organisers see it in the bell (in-app only: emailing every RSVP would flood inboxes).
    const organisers = await this.prisma.eventMembership.findMany({ where: { eventId: guest.eventId, status: 'ACTIVE' }, include: { user: { select: { id: true, name: true, email: true } } } });
    await this.notifier.dispatch({
      eventId: guest.eventId,
      kind: 'rsvp.updated',
      url: `/events/${guest.eventId}?tab=guests`,
      recipients: organisers.map((o) => o.user),
      inApp: () => ({
        title: `${guest.name} ${status === 'CONFIRMED' ? 'is going to' : "can't make it to"} ${activity.name}`,
        body: previous === 'PENDING' ? 'New RSVP' : `Changed from ${previous === 'CONFIRMED' ? 'going' : 'not going'}`,
      }),
    });
  }

  /** FR-115, FR-116 — counts per activity and each guest's answers (organisers only). */
  async overview(eventId: string, userId: string): Promise<RsvpOverview> {
    await this.events.authorize(eventId, userId, 'event.view');
    const [activities, guests, rsvps] = await Promise.all([
      this.prisma.activity.findMany({ where: { eventId }, select: { id: true, capacity: true }, orderBy: { startsAt: 'asc' } }),
      this.prisma.guest.findMany({ where: { eventId, removedAt: null }, select: { id: true, allActivities: true, assignments: { select: { activityId: true } } } }),
      this.prisma.rsvp.findMany({ where: { guest: { eventId, removedAt: null }, status: { not: 'PENDING' } }, select: { guestId: true, activityId: true, status: true } }),
    ]);
    const answers: RsvpOverview['answers'] = {};
    for (const r of rsvps) (answers[r.guestId] ??= {})[r.activityId] = r.status as 'CONFIRMED' | 'DECLINED';

    return {
      answers,
      activities: activities.map((a) => {
        const invited = guests.filter((g) => g.allActivities || g.assignments.some((x) => x.activityId === a.id));
        const confirmed = invited.filter((g) => answers[g.id]?.[a.id] === 'CONFIRMED').length;
        const declined = invited.filter((g) => answers[g.id]?.[a.id] === 'DECLINED').length;
        return { activityId: a.id, invited: invited.length, confirmed, declined, pending: invited.length - confirmed - declined, capacity: a.capacity };
      }),
    };
  }

  /** FR-190, FR-191 — .ics for one of the guest's activities, or all of them. */
  async calendar(ctx: GuestContext, activityId?: string): Promise<{ filename: string; ics: string }> {
    const guest = await this.prisma.guest.findUniqueOrThrow({ where: { id: ctx.guestId }, include: { assignments: true, event: true } });
    if (activityId) await this.assignedActivity(ctx, activityId);
    const activities = await this.prisma.activity.findMany({
      where: {
        eventId: guest.eventId,
        status: { not: 'CANCELLED' },
        ...(activityId ? { id: activityId } : guest.allActivities ? {} : { id: { in: guest.assignments.map((a) => a.activityId) } }),
      },
      orderBy: { startsAt: 'asc' },
    });
    const url = `${this.config.appOrigin}/my-event`;
    const ics = buildIcs({
      calendarName: guest.event.name,
      timezone: guest.event.timezone,
      events: activities.map((a) => ({
        uid: `${a.id}@gatherly`,
        start: a.startsAt,
        end: a.endsAt,
        summary: `${a.name} · ${guest.event.name}`,
        location: [a.venueName, a.venueAddress].filter(Boolean).join(', ') || a.virtualMeetingUrl || undefined,
        description: [a.description, a.virtualMeetingUrl ? `Join online: ${a.virtualMeetingUrl}` : '', `Times in ${a.timezone}.`, `Details: ${url}`].filter(Boolean).join('\n\n'),
        url,
      })),
    });
    const slug = (activityId ? activities[0]?.name : guest.event.name)?.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'event';
    return { filename: `${slug}.ics`, ics };
  }
}
