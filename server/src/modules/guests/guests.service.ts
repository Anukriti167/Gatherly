import {
  ACTIVITY_LIST_SEPARATOR,
  ALL_ACTIVITIES_WORDS,
  createGuestSchema,
  GUEST_IMPORT_MAX_ROWS,
  parseCsv,
  type CreateGuestData,
  type EventAction,
  type GuestView,
  type ImportReport,
  type ImportRowResult,
  type ImportRowStatus,
  type UpdateGuestData,
} from '@gatherly/shared';
import type { AppConfig } from '../../config/env.ts';
import { AppError, badRequest, forbidden, notFound } from '../../lib/errors.ts';

import type { NotificationsService } from '../notifications/notifications.service.ts';
import type { PrismaClient, db } from '../../lib/prisma.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { diffFields, type EventsService } from '../events/events.service.ts';
import { guestListChangedEmail } from './guests.emails.ts';
import { revokeGuestAccess } from '../invitations/invitations.service.ts';

type Tx = db.Prisma.TransactionClient;
type GuestRow = db.Prisma.GuestGetPayload<{ include: { assignments: true } }>;

function toView(g: GuestRow): GuestView {
  return {
    id: g.id,
    name: g.name,
    email: g.email,
    phone: g.phone,
    allActivities: g.allActivities,
    activityIds: g.assignments.map((a) => a.activityId),
    createdAt: g.createdAt.toISOString(),
  };
}

const duplicateEmail = () =>
  new AppError(409, 'DUPLICATE_GUEST', 'A guest with this email is already on the list.', { email: ['A guest with this email is already on the list'] });

/** Column headings we recognise in uploaded spreadsheets (case-insensitive). */
const HEADINGS = {
  name: ['name', 'full name', 'guest name', 'guest'],
  first: ['first name', 'firstname', 'given name'],
  last: ['last name', 'lastname', 'surname', 'family name'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'mail'],
  phone: ['phone', 'phone number', 'mobile', 'mobile number', 'contact', 'contact number', 'whatsapp', 'tel'],
  activities: ['activities', 'activity', 'invited to', 'events', 'sessions', 'functions'],
};

function findColumns(header: string[]) {
  const norm = header.map((h) => h.toLowerCase().replace(/[_*]/g, ' ').replace(/\s+/g, ' ').trim());
  const idx = (aliases: string[]) => norm.findIndex((h) => aliases.includes(h));
  return {
    name: idx(HEADINGS.name),
    first: idx(HEADINGS.first),
    last: idx(HEADINGS.last),
    email: idx(HEADINGS.email),
    phone: idx(HEADINGS.phone),
    activities: idx(HEADINGS.activities),
  };
}

const normaliseName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Turns an Activities cell ("All", "Sangeet; Reception", or empty) into this event's activities.
 * Matching ignores case and extra spaces; unknown or ambiguous names become row errors.
 */
export function activityResolver(activities: { id: string; name: string }[]) {
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const a of activities) {
    const key = normaliseName(a.name);
    byName.set(key, [...(byName.get(key) ?? []), a]);
  }
  const known = activities.map((a) => a.name).join(', ') || 'no activities yet';

  return (cell: string): { invitedTo: ImportRowResult['invitedTo']; errors: string[] } => {
    const text = cell.trim();
    if (!text) return { invitedTo: null, errors: [] }; // use the import's default
    if (ALL_ACTIVITIES_WORDS.includes(normaliseName(text))) return { invitedTo: { all: true, activityIds: [], names: [] }, errors: [] };

    const errors: string[] = [];
    const ids: string[] = [];
    const names: string[] = [];
    for (const part of text.split(ACTIVITY_LIST_SEPARATOR).map((p) => p.trim()).filter(Boolean)) {
      const matches = byName.get(normaliseName(part)) ?? [];
      if (matches.length === 0) errors.push(`activities: Unknown activity “${part}”. This event has: ${known}`);
      else if (matches.length > 1) errors.push(`activities: Several activities are called “${part}” — rename one so they can be told apart`);
      else if (!ids.includes(matches[0]!.id)) {
        ids.push(matches[0]!.id);
        names.push(matches[0]!.name);
      }
    }
    return { invitedTo: errors.length ? null : { all: false, activityIds: ids, names }, errors };
  };
}

/**
 * The event's shared guest list (FR-068 – FR-082).
 *
 * Product rules (14 Nov 2026): owner and co-admins add and edit guests directly at any time —
 * before or after publishing. Removing a guest after publishing cuts off their access, so it needs
 * everyone's approval (change proposal). The guest list is not part of the approved event content:
 * changes don't bump the event version or reset pending approvals. Every change is audited and
 * emailed to the other organisers, listing exactly what changed.
 */
export class GuestsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly events: EventsService,
    private readonly audit: AuditService,
    private readonly notifier: NotificationsService,
    private readonly config: AppConfig,
  ) {}

  /** FR-081 — organisers only; includes contact details (FR-082). */
  async list(eventId: string, userId: string): Promise<GuestView[]> {
    await this.events.authorize(eventId, userId, 'event.view');
    const rows = await this.prisma.guest.findMany({
      where: { eventId, removedAt: null },
      include: { assignments: true },
      orderBy: [{ name: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map(toView);
  }

  /** FR-068 */
  async create(eventId: string, userId: string, input: CreateGuestData): Promise<GuestView> {
    await this.authorizeGuests(eventId, userId, 'guests.manage');
    const guest = await this.prisma.$transaction(async (tx) => {
      await this.assertActivities(tx, eventId, input.activityIds);
      if (await this.emailTaken(tx, eventId, input.email)) throw duplicateEmail();
      const created = await tx.guest.create({
        data: {
          eventId,
          name: input.name,
          email: input.email,
          phone: input.phone ?? null,
          allActivities: input.allActivities,
          createdById: userId,
          assignments: { create: input.allActivities ? [] : input.activityIds.map((activityId) => ({ activityId })) },
        },
        include: { assignments: true },
      });
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'guest.added', entityType: 'Guest', entityId: created.id, after: this.auditShape(created) },
        tx,
      );
      return created;
    });

    const names = await this.activityNames(eventId);
    await this.notify(eventId, userId, 'added a guest', [`${guest.name} (${guest.email}) — ${this.invitedTo(guest, names)}`]);
    return toView(guest);
  }

  /** FR-075, FR-078 — includes changing activity assignments. */
  async update(eventId: string, guestId: string, userId: string, input: UpdateGuestData): Promise<GuestView> {
    await this.authorizeGuests(eventId, userId, 'guests.manage');
    const { current, updated } = await this.prisma.$transaction(async (tx) => {
      const current = await this.findActive(tx, eventId, guestId);
      if (input.email && input.email !== current.email && (await this.emailTaken(tx, eventId, input.email))) throw duplicateEmail();
      if (input.activityIds) await this.assertActivities(tx, eventId, input.activityIds);

      await tx.guest.update({
        where: { id: guestId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.email !== undefined && { email: input.email }),
          ...(input.phone !== undefined && { phone: input.phone }),
          ...(input.allActivities !== undefined && { allActivities: input.allActivities }),
        },
      });
      const allActivities = input.allActivities ?? current.allActivities;
      if (input.activityIds || allActivities) {
        await tx.guestActivityAssignment.deleteMany({ where: { guestId } });
        if (!allActivities && input.activityIds?.length) {
          await tx.guestActivityAssignment.createMany({ data: input.activityIds.map((activityId) => ({ guestId, activityId })) });
        }
      }
      const updated = await tx.guest.findUniqueOrThrow({ where: { id: guestId }, include: { assignments: true } });
      const { before, after } = diffFields(this.auditShape(current), this.auditShape(updated), ['name', 'email', 'phone', 'allActivities', 'activityIds']);
      if (Object.keys(after).length) {
        await this.audit.record({ eventId, actor: { type: 'USER', userId }, action: 'guest.updated', entityType: 'Guest', entityId: guestId, before, after }, tx);
      }
      return { current, updated };
    });

    const names = await this.activityNames(eventId);
    const changes = this.describeChanges(current, updated, names);
    if (changes.length) await this.notify(eventId, userId, `updated ${updated.name}`, changes);
    return toView(updated);
  }

  /**
   * FR-079 — direct before publishing. After publishing, removal cuts off the guest's access and
   * needs a change proposal approved by all organisers. Soft delete keeps history.
   */
  async remove(eventId: string, guestId: string, userId: string): Promise<void> {
    await this.authorizeGuests(eventId, userId, 'guests.remove');
    const removed = await this.prisma.$transaction(async (tx) => {
      const current = await this.findActive(tx, eventId, guestId);
      await tx.guestActivityAssignment.deleteMany({ where: { guestId } });
      await tx.guest.update({ where: { id: guestId }, data: { removedAt: new Date() } });
      await revokeGuestAccess(tx, guestId, userId); // FR-203: their link and sessions stop working now
      await this.audit.record(
        { eventId, actor: { type: 'USER', userId }, action: 'guest.removed', entityType: 'Guest', entityId: guestId, before: this.auditShape(current) },
        tx,
      );
      return current;
    });
    await this.notify(eventId, userId, 'removed a guest', [`${removed.name} (${removed.email})`]);
  }

  /**
   * FR-069 – FR-071, FR-074 — validate a CSV (Name, Email, optional Phone; or First/Last name).
   * `preview` reports every row without saving; `commit` adds the valid, non-duplicate rows.
   */
  async import(
    eventId: string,
    userId: string,
    opts: { csv: string; mode: 'preview' | 'commit'; allActivities: boolean; activityIds: string[] },
  ): Promise<ImportReport> {
    await this.authorizeGuests(eventId, userId, 'guests.manage');
    const report = await this.analyse(this.prisma, eventId, opts.csv);
    if (opts.mode === 'preview') return report;

    const { result, added } = await this.prisma.$transaction(async (tx) => {
      await this.assertActivities(tx, eventId, opts.activityIds);
      // Re-check against the list inside the transaction (another organiser may have added guests).
      const fresh = await this.analyse(tx, eventId, opts.csv);
      const toAdd = fresh.rows.filter((r) => r.status === 'ok');
      // Each row uses its own Activities cell; empty cells fall back to the import's default.
      const assignmentOf = (r: ImportRowResult) =>
        r.invitedTo ? { all: r.invitedTo.all, ids: r.invitedTo.activityIds } : { all: opts.allActivities, ids: opts.activityIds };
      if (toAdd.length) {
        const created = await tx.guest.createManyAndReturn({
          data: toAdd.map((r) => ({ eventId, name: r.name, email: r.email, phone: r.phone, allActivities: assignmentOf(r).all, createdById: userId })),
          select: { id: true, email: true },
        });
        const idByEmail = new Map(created.map((g) => [g.email, g.id]));
        const assignments = toAdd.flatMap((r) => {
          const a = assignmentOf(r);
          const guestId = idByEmail.get(r.email)!;
          return a.all ? [] : a.ids.map((activityId) => ({ guestId, activityId }));
        });
        if (assignments.length) await tx.guestActivityAssignment.createMany({ data: assignments });
      }
      await this.audit.record(
        {
          eventId,
          actor: { type: 'USER', userId },
          action: 'guests.imported',
          entityType: 'Event',
          entityId: eventId,
          metadata: { imported: toAdd.length, skipped: fresh.rows.length - toAdd.length, emails: toAdd.map((r) => r.email) },
        },
        tx,
      );
      return { result: { ...fresh, mode: 'commit' as const, imported: toAdd.length }, added: toAdd };
    });

    if (added.length) {
      const names = await this.activityNames(eventId);
      const describe = (all: boolean, ids: string[]) =>
        all ? 'all activities' : ids.length ? ids.map((id) => names.get(id) ?? 'an activity').join(', ') : 'no activities yet';
      await this.notify(
        eventId,
        userId,
        `imported ${added.length} guest${added.length === 1 ? '' : 's'}`,
        added.map((r) => {
          const invited = r.invitedTo ? describe(r.invitedTo.all, r.invitedTo.activityIds) : describe(opts.allActivities, opts.activityIds);
          return `${r.name} (${r.email}) — invited to ${invited}`;
        }),
      );
    }
    return result;
  }

  // ─── helpers ────────────────────────────────────────────────────────────────

  private async authorizeGuests(eventId: string, userId: string, action: Extract<EventAction, 'guests.manage' | 'guests.remove'>) {
    try {
      return await this.events.authorize(eventId, userId, action);
    } catch (err) {
      if (action === 'guests.remove' && err instanceof AppError && err.status === 403) {
        const { event } = await this.events.loadForMember(eventId, userId);
        if (event.status === 'PUBLISHED') {
          throw forbidden('This event is published. Removing a guest cuts off their access, so it needs approval from all organisers through a change proposal.');
        }
      }
      throw err;
    }
  }

  private async analyse(client: Pick<PrismaClient, 'guest' | 'activity'>, eventId: string, csv: string): Promise<ImportReport> {
    const table = parseCsv(csv);
    if (table.length < 2) throw badRequest('The file needs a heading row and at least one guest.');
    if (table.length - 1 > GUEST_IMPORT_MAX_ROWS) throw badRequest(`Up to ${GUEST_IMPORT_MAX_ROWS} guests can be imported at once.`);

    const cols = findColumns(table[0]!);
    const hasName = cols.name >= 0 || cols.first >= 0;
    if (!hasName || cols.email < 0) {
      throw badRequest('The first row must contain column headings: “Name” (or “First name” / “Last name”) and “Email”. “Phone” and “Activities” are optional.');
    }

    const existing = new Set(
      (await client.guest.findMany({ where: { eventId, removedAt: null }, select: { email: true } })).map((g) => g.email),
    );
    const activities = await client.activity.findMany({ where: { eventId }, select: { id: true, name: true }, orderBy: { startsAt: 'asc' } });
    const resolveActivities = activityResolver(activities);

    const seen = new Set<string>();
    const rows: ImportRowResult[] = table.slice(1).map((cells, i) => {
      const get = (c: number) => (c >= 0 ? (cells[c] ?? '') : '');
      const name = cols.name >= 0 ? get(cols.name) : [get(cols.first), get(cols.last)].filter(Boolean).join(' ');
      const parsed = createGuestSchema.safeParse({ name, email: get(cols.email), phone: get(cols.phone) });
      const activitiesCell = resolveActivities(get(cols.activities));
      const base = { line: i + 2, name, email: get(cols.email).toLowerCase(), phone: get(cols.phone) || null, invitedTo: activitiesCell.invitedTo };

      const errors = [
        ...(parsed.success ? [] : parsed.error.issues.map((iss) => `${String(iss.path[0])}: ${iss.message}`)),
        ...activitiesCell.errors,
      ];
      if (!parsed.success || errors.length) return { ...base, status: 'invalid' as const, errors };

      const { email, phone } = parsed.data;
      const row = { ...base, name: parsed.data.name, email, phone: phone ?? null, errors: [] as string[] };
      if (existing.has(email)) return { ...row, status: 'already-on-list' as const };
      if (seen.has(email)) return { ...row, status: 'duplicate-in-file' as const };
      seen.add(email);
      return { ...row, status: 'ok' as const };
    });

    const counts: Record<ImportRowStatus, number> = { ok: 0, invalid: 0, 'duplicate-in-file': 0, 'already-on-list': 0 };
    for (const r of rows) counts[r.status] += 1;
    return {
      mode: 'preview',
      columns: {
        name: cols.name >= 0 ? cols.name : cols.first,
        email: cols.email,
        phone: cols.phone >= 0 ? cols.phone : null,
        activities: cols.activities >= 0 ? cols.activities : null,
      },
      rows,
      counts,
      rowsUsingDefault: rows.filter((r) => r.status === 'ok' && r.invitedTo === null).length,
      imported: 0,
    };
  }

  private async findActive(tx: Tx, eventId: string, guestId: string): Promise<GuestRow> {
    const guest = await tx.guest.findFirst({ where: { id: guestId, eventId, removedAt: null }, include: { assignments: true } });
    if (!guest) throw notFound('Guest not found');
    return guest;
  }

  private async emailTaken(tx: Tx, eventId: string, email: string): Promise<boolean> {
    return (await tx.guest.count({ where: { eventId, email, removedAt: null } })) > 0;
  }

  /** Activity ids must belong to this event (no cross-event assignment). */
  private async assertActivities(tx: Tx, eventId: string, ids: string[]): Promise<void> {
    const unique = [...new Set(ids)];
    if (!unique.length) return;
    const found = await tx.activity.count({ where: { eventId, id: { in: unique } } });
    if (found !== unique.length) throw badRequest('Please check the highlighted fields', { activityIds: ['One or more activities are not part of this event'] });
  }

  private auditShape(g: GuestRow) {
    return { name: g.name, email: g.email, phone: g.phone, allActivities: g.allActivities, activityIds: g.assignments.map((a) => a.activityId).sort() };
  }

  private async activityNames(eventId: string): Promise<Map<string, string>> {
    const rows = await this.prisma.activity.findMany({ where: { eventId }, select: { id: true, name: true }, orderBy: { startsAt: 'asc' } });
    return new Map(rows.map((a) => [a.id, a.name]));
  }

  private invitedTo(g: GuestRow, names: Map<string, string>): string {
    if (g.allActivities) return 'invited to all activities';
    const list = g.assignments.map((a) => names.get(a.activityId)).filter(Boolean);
    return list.length ? `invited to ${list.join(', ')}` : 'not invited to any activity yet';
  }

  /** Human-readable "what changed" lines for the notification email. */
  private describeChanges(before: GuestRow, after: GuestRow, names: Map<string, string>): string[] {
    const lines: string[] = [];
    const show = (v: string | null) => (v ? v : '—');
    if (before.name !== after.name) lines.push(`Name: ${before.name} → ${after.name}`);
    if (before.email !== after.email) lines.push(`Email: ${before.email} → ${after.email}`);
    if (before.phone !== after.phone) lines.push(`Phone: ${show(before.phone)} → ${show(after.phone)}`);
    // Activity changes are spelled out — taking an activity away cuts off the guest's access to it,
    // so organisers are told explicitly (decided with the product owner: direct + notify).
    const label = (ids: string[]) => ids.map((id) => names.get(id) ?? 'an activity').join(', ');
    const was = new Set(before.assignments.map((x) => x.activityId));
    const now = new Set(after.assignments.map((x) => x.activityId));
    if (!before.allActivities && after.allActivities) {
      lines.push('Now invited to all activities');
    } else if (before.allActivities && !after.allActivities) {
      lines.push(now.size ? `No longer invited to all activities — now only: ${label([...now])}` : 'No longer invited to any activity');
    } else if (!after.allActivities) {
      const added = [...now].filter((id) => !was.has(id));
      const removed = [...was].filter((id) => !now.has(id));
      if (added.length) lines.push(`Now also invited to: ${label(added)}`);
      if (removed.length) lines.push(`No longer invited to: ${label(removed)}`);
    }
    return lines;
  }

  /** Emails every OTHER active organiser what changed on the guest list. */
  private async notify(eventId: string, actorId: string, summary: string, lines: string[]): Promise<void> {
    const organisers = await this.prisma.eventMembership.findMany({
      where: { eventId, status: 'ACTIVE' },
      include: { user: { select: { id: true, name: true, email: true } }, event: { select: { name: true } } },
    });
    const actorName = organisers.find((o) => o.userId === actorId)?.user.name ?? 'An organiser';
    const eventName = organisers[0]?.event.name ?? 'your event';
    const shown = lines.slice(0, 3).join('; ') + (lines.length > 3 ? ` … and ${lines.length - 3} more` : '');
    await this.notifier.dispatch({
      eventId,
      kind: 'guests.changed',
      url: `/events/${eventId}?tab=guests`,
      recipients: organisers.filter((o) => o.userId !== actorId).map((o) => o.user),
      inApp: () => ({ title: `${actorName} ${summary}`, body: shown }),
      email: (r) =>
        guestListChangedEmail({ to: r.email, name: r.name, actorName, eventName, summary, lines, url: `${this.config.appOrigin}/events/${eventId}?tab=guests` }),
    });
  }
}
