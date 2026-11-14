import type { EventHistoryEntry, EventHistoryPage } from '@gatherly/shared';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { EventsService } from '../events/events.service.ts';

type Row = db.AuditLog & { actorUser: { name: string } | null };
type Json = Record<string, unknown> | null;

const FIELD_LABEL: Record<string, string> = {
  name: 'name',
  description: 'description',
  eventType: 'event type',
  customTypeLabel: 'occasion',
  planningPath: 'planning style',
  timezone: 'timezone',
  startsAt: 'start time',
  endsAt: 'end time',
  instructions: 'instructions',
  organiserContactName: 'organiser contact',
  organiserContactEmail: 'organiser email',
  organiserContactPhone: 'organiser phone',
  guestUploadsEnabled: 'guest photo uploads',
  venueName: 'venue name',
  venueAddress: 'location',
  venueLatitude: 'location',
  venueLongitude: 'location',
  virtualMeetingUrl: 'meeting link',
  capacity: 'capacity',
  rsvpDeadline: 'RSVP deadline',
  dressCode: 'dress code',
  themeDescription: 'theme',
  themeColors: 'theme colours',
  showPeople: 'section visibility',
  showItinerary: 'section visibility',
  showMenu: 'section visibility',
  showDressCode: 'section visibility',
  showTheme: 'section visibility',
  showInstructions: 'section visibility',
  itinerary: 'itinerary',
  menu: 'menu',
  people: 'speakers & performers',
  phone: 'phone',
  email: 'email',
  allActivities: 'activities',
  activityIds: 'activities',
};

/** Which audit actions belong to each History filter. */
const CATEGORY_ACTIONS: Record<EventHistoryEntry['category'], string[]> = {
  event: ['event.created', 'event.updated', 'event.unpublished', 'event.cancelled', 'event.completed'],
  activity: ['activity.'],
  guests: ['guest.', 'guests.', 'invitation', 'rsvp.'],
  organisers: ['coadmin.'],
  approval: ['publication.', 'event.published'],
  proposal: ['proposal.'],
};

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** "description, start time and menu" */
function changedFields(after: Json): string {
  const labels = [...new Set(Object.keys(after ?? {}).map((k) => FIELD_LABEL[k] ?? k))];
  if (labels.length <= 1) return labels[0] ?? 'details';
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/**
 * Turns raw audit entries into a readable event timeline (FR-197 – FR-199): who did what, when.
 * Organisers only — it may mention guest names and emails.
 */
export class EventHistoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
  ) {}

  async list(eventId: string, userId: string, opts: { limit?: number; before?: string; category?: EventHistoryEntry['category'] } = {}): Promise<EventHistoryPage> {
    await this.events.authorize(eventId, userId, 'audit.view');
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    let cursor: Date | undefined;
    if (opts.before) cursor = (await this.prisma.auditLog.findFirst({ where: { id: opts.before, eventId }, select: { createdAt: true } }))?.createdAt;

    const rows = await this.prisma.auditLog.findMany({
      where: {
        eventId,
        ...(cursor ? { createdAt: { lt: cursor } } : {}),
        ...(opts.category ? { OR: CATEGORY_ACTIONS[opts.category].map((p) => ({ action: { startsWith: p } })) } : {}),
      },
      include: { actorUser: { select: { name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const page = rows.slice(0, limit);

    // Names for things referenced only by id.
    const proposalIds = page.filter((r) => r.entityType === 'ChangeProposal').map((r) => r.entityId);
    const proposals = new Map(
      (await this.prisma.changeProposal.findMany({ where: { id: { in: proposalIds } }, select: { id: true, title: true } })).map((p) => [p.id, p.title]),
    );
    const memberIds = page.filter((r) => r.entityType === 'EventMembership').map((r) => r.entityId);
    const members = new Map(
      (await this.prisma.eventMembership.findMany({ where: { id: { in: memberIds } }, include: { user: { select: { name: true } } } })).map((m) => [m.id, m.user.name]),
    );

    return {
      entries: page.map((r) => this.describe(r, proposals, members)),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private describe(r: Row, proposals: Map<string, string>, members: Map<string, string>): EventHistoryEntry {
    const before = obj(r.before);
    const after = obj(r.after);
    const meta = obj(r.metadata);
    const actor =
      r.actorType === 'SYSTEM' ? 'Gatherly' : r.actorType === 'GUEST' ? str(obj(r.metadata)?.['guestName']) || 'A guest' : (r.actorUser?.name ?? 'Someone');
    const base = { id: r.id, at: r.createdAt.toISOString(), actor };
    const proposal = proposals.get(r.entityId);
    const member = members.get(r.entityId) || str(after?.['email']) || str(before?.['email']);
    const version = typeof meta?.['eventVersion'] === 'number' ? ` (version ${meta['eventVersion']})` : '';
    const comment = str(meta?.['comment']);

    const e = (category: EventHistoryEntry['category'], summary: string, details: string[] = []): EventHistoryEntry => ({ ...base, category, summary, details });

    switch (r.action) {
      case 'event.created':
        return e('event', 'created the event');
      case 'event.updated':
        return e('event', `changed the event's ${changedFields(after)}`);
      case 'event.published':
        return e('approval', `gave the final approval — the event was published${version}`);
      case 'event.unpublished':
        return e('event', 'unpublished the event (approved by all organisers)');
      case 'event.cancelled':
        return e('event', 'cancelled the event (approved by all organisers)', str(meta?.['reason']) ? [`Reason: ${str(meta?.['reason'])}`] : []);
      case 'event.completed':
        return r.actorType === 'SYSTEM' ? e('event', 'marked the event as completed — it has ended') : e('event', 'marked the event as completed early (approved by all organisers)');

      case 'activity.created':
        return e('activity', `added the activity “${str(after?.['name'])}”`);
      case 'activity.updated':
        return e('activity', `updated an activity's ${changedFields(after)}`);
      case 'activity.deleted':
        return e('activity', `removed the activity “${str(before?.['name'])}”`);

      case 'guest.added':
        return e('guests', `added the guest ${str(after?.['name'])}`, [str(after?.['email'])]);
      case 'guest.updated':
        return e('guests', `updated ${str(before?.['name']) || str(after?.['name']) || 'a guest'}'s ${changedFields(after)}`);
      case 'guest.removed':
        return e('guests', `removed the guest ${str(before?.['name'])}${meta?.['proposalId'] ? ' (approved by all organisers)' : ''}`, [str(before?.['email'])]);
      case 'guests.imported': {
        const n = Number(meta?.['imported'] ?? 0);
        return e('guests', `imported ${n} guest${n === 1 ? '' : 's'} from a spreadsheet`);
      }

      case 'invitations.sent': {
        const n = Number(meta?.['count'] ?? 0);
        const resent = Number(meta?.['resent'] ?? 0);
        return e('guests', `sent ${n} invitation${n === 1 ? '' : 's'}${resent ? ` (${resent} re-sent with a new link)` : ''}`);
      }
      case 'invitation.revoked':
        return e('guests', `revoked ${str(before?.['name']) || 'a guest'}'s invitation link`);
      case 'rsvp.updated': {
        const status = str(after?.['status']);
        return e('guests', `replied “${status === 'CONFIRMED' ? 'Going' : 'Can’t make it'}” to ${str(meta?.['activityName']) || 'an activity'}`);
      }

      case 'coadmin.invited':
        return e('organisers', `invited ${str(after?.['email']) || member} as a co-admin`);
      case 'coadmin.accepted':
        return e('organisers', 'accepted the invitation and became a co-admin');
      case 'coadmin.declined':
        return e('organisers', 'declined the co-admin invitation');
      case 'coadmin.removed':
        return e('organisers', `removed ${member || 'a co-admin'} as a co-admin`);
      case 'coadmin.invitation_cancelled':
        return e('organisers', `cancelled the co-admin invitation for ${member || 'someone'}`);

      case 'publication.submitted':
        return e('approval', `submitted the event for publication${version}`);
      case 'publication.approved':
        return e('approval', `approved publishing${version}`, comment ? [`“${comment}”`] : []);
      case 'publication.changes_requested':
        return e('approval', `requested changes before publishing${version}`, comment ? [`“${comment}”`] : []);
      case 'publication.round_restarted':
        return e('approval', `edited the event while it awaited approval — approvals were reset${version}`);

      case 'proposal.created':
        return e('proposal', `proposed “${proposal ?? str(after?.['title'])}”`);
      case 'proposal.approved':
        return e('proposal', `approved “${proposal ?? 'a proposal'}”`, comment ? [`“${comment}”`] : []);
      case 'proposal.objected':
        return e('proposal', `objected to “${proposal ?? 'a proposal'}”`, comment ? [`“${comment}”`] : []);
      case 'proposal.revised':
        return e('proposal', `revised “${proposal ?? 'a proposal'}”`);
      case 'proposal.withdrawn':
        return e('proposal', `withdrew “${proposal ?? 'a proposal'}”`);
      case 'proposal.applied':
        return e('proposal', `gave the final approval — “${proposal ?? 'a proposal'}” was applied`);

      default:
        return e('event', r.action.replace(/[._]/g, ' '));
    }
  }
}
