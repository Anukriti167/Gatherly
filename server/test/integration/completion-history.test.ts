import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.ts';
import { AuditService } from '../../src/modules/audit/audit.service.ts';
import { CompletionService } from '../../src/modules/completion/completion.service.ts';
import { NotificationsService } from '../../src/modules/notifications/notifications.service.ts';
import { createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer, config } = createTestContext();
const logger = createLogger(config);
const completion = new CompletionService(prisma, new AuditService(prisma), new NotificationsService(prisma, mailer, logger), config, logger);

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

/** Local "YYYY-MM-DDTHH:mm" in UTC, offset by hours from now. */
const at = (hoursFromNow: number) => new Date(Date.now() + hoursFromNow * 3_600_000).toISOString().slice(0, 16);

/** Published event (sole owner → publishes on submit) with the given times and activities. */
async function publishedEvent(opts: { start: number; end: number; activities: { name: string; start: number; end: number }[]; coAdmin?: boolean }) {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (
    await owner.client.post('/api/v1/events', { name: 'Summit', eventType: 'SUMMIT', timezone: 'UTC', startsAt: at(opts.start), endsAt: at(opts.end) })
  ).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  const ids: Record<string, string> = {};
  for (const a of opts.activities) {
    ids[a.name] = (await owner.client.post(api('/activities'), { activity: { name: a.name, timezone: 'UTC', startsAt: at(a.start), endsAt: at(a.end) } })).body.activity.id;
  }
  let co: Awaited<ReturnType<typeof signedInUser>> | undefined;
  if (opts.coAdmin) {
    co = await signedInUser(app, 'Rohan CoAdmin');
    await owner.client.post(api('/members'), { email: co.email });
    await co.client.post(api('/members/me/accept'));
  }
  const v = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;
  await owner.client.post(api('/publication/submit'), { expectedVersion: v });
  if (co) await co.client.post(api('/publication/approve'), { expectedVersion: v });
  expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('PUBLISHED');
  mailer.clear();
  return { owner, co, eventId, api, ids };
}

const activityStatus = async (id: string) => (await prisma.activity.findUniqueOrThrow({ where: { id } })).status;

describe('automatic completion (FR-017, FR-018)', () => {
  it('completes a published event once it has ended, with its activities, closing open proposals', async () => {
    const { owner, co, eventId, api, ids } = await publishedEvent({
      start: -5,
      end: 1,
      activities: [{ name: 'Keynote', start: -5, end: -4 }],
      coAdmin: true,
    });
    const g = (await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co' } })).body.guest;
    const p = (await owner.client.post(api('/proposals'), { title: 'Remove A', description: 'x', changes: [{ type: 'REMOVE_GUESTS', guestIds: [g.id] }] })).body.proposal;

    // Event still running: only the finished activity completes.
    await completion.run();
    expect(await activityStatus(ids['Keynote']!)).toBe('COMPLETED');
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('PUBLISHED');

    // After the end time passes, the event completes.
    const result = await completion.run(new Date(Date.now() + 2 * 3_600_000));
    expect(result.events).toEqual([eventId]);
    const ev = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(ev.status).toBe('COMPLETED');
    expect(ev.completedAt).not.toBeNull();
    expect((await owner.client.get(api(`/proposals/${p.id}`))).body.proposal).toMatchObject({ status: 'CLOSED', closedReason: 'The event has ended' });

    // Organisers notified (in-app + email); audit entry by the system.
    const box = (await co!.client.get('/api/v1/me/notifications')).body;
    expect(box.notifications[0]).toMatchObject({ kind: 'event.completed', title: 'Completed: Summit' });
    expect(mailer.lastTo(owner.email)?.subject).toBe('Completed: “Summit”');
    expect(await prisma.auditLog.count({ where: { eventId, action: 'event.completed', actorType: 'SYSTEM' } })).toBe(1);

    // Running again changes nothing.
    expect((await completion.run(new Date(Date.now() + 3 * 3_600_000))).events).toEqual([]);
  });

  it('never completes drafts or events awaiting approval', async () => {
    const owner = await signedInUser(app);
    const id = (await owner.client.post('/api/v1/events', { name: 'Old draft', eventType: 'PARTY', timezone: 'UTC', startsAt: at(-10), endsAt: at(-5) })).body.event.id;
    await completion.run();
    expect((await prisma.event.findUniqueOrThrow({ where: { id } })).status).toBe('DRAFT');
  });

  it('a completed event is read-only', async () => {
    const { owner, eventId, api } = await publishedEvent({ start: -5, end: -1, activities: [{ name: 'Talk', start: -5, end: -4 }] });
    await completion.run();
    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('COMPLETED');
    expect((await owner.client.post(api('/guests'), { guest: { name: 'Late', email: 'late@x.co' } })).status).toBe(403);
    expect((await owner.client.post(api('/proposals'), { title: 'x', description: 'y', changes: [{ type: 'UNPUBLISH' }] })).status).toBe(403);
  });
});

describe('completing early by proposal', () => {
  it('needs the event to have started', async () => {
    const { owner, api } = await publishedEvent({ start: 5, end: 10, activities: [{ name: 'Talk', start: 5, end: 6 }], coAdmin: true });
    const res = await owner.client.post(api('/proposals'), { title: 'Done', description: 'x', changes: [{ type: 'COMPLETE_EVENT' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/once it has started/);
  });

  it('once everyone approves: started activities complete, unstarted ones are cancelled', async () => {
    const { owner, co, eventId, api, ids } = await publishedEvent({
      start: -2,
      end: 24,
      activities: [
        { name: 'Day 1', start: -2, end: 3 },
        { name: 'Day 2', start: 20, end: 23 },
      ],
      coAdmin: true,
    });
    const p = (await owner.client.post(api('/proposals'), { title: 'Wrap up early', description: 'Rain on day 2', changes: [{ type: 'COMPLETE_EVENT' }] })).body.proposal;
    await co!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 });

    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('COMPLETED');
    expect(await activityStatus(ids['Day 1']!)).toBe('COMPLETED');
    expect(await activityStatus(ids['Day 2']!)).toBe('CANCELLED');
  });

  it('cannot be combined with unpublishing or cancelling', async () => {
    const { owner, api } = await publishedEvent({ start: -2, end: 5, activities: [{ name: 'A', start: -2, end: 1 }], coAdmin: true });
    const res = await owner.client.post(api('/proposals'), { title: 'x', description: 'y', changes: [{ type: 'COMPLETE_EVENT' }, { type: 'CANCEL_EVENT' }] });
    expect(res.status).toBe(400);
  });
});

describe('dashboard grouping (FR-007, FR-181, FR-185)', () => {
  it('puts cancelled events only under "cancelled", and early-completed events under "completed"', async () => {
    const a = await publishedEvent({ start: 10, end: 20, activities: [{ name: 'A', start: 10, end: 11 }] });
    await a.owner.client.post(a.api('/proposals'), { title: 'Cancel', description: 'x', changes: [{ type: 'CANCEL_EVENT' }] });

    const b = await publishedEvent({ start: -1, end: 20, activities: [{ name: 'B', start: -1, end: 1 }] });
    await b.owner.client.post(b.api('/proposals'), { title: 'Done', description: 'x', changes: [{ type: 'COMPLETE_EVENT' }] });

    const [ea] = (await a.owner.client.get('/api/v1/events')).body.events;
    const [eb] = (await b.owner.client.get('/api/v1/events')).body.events;
    expect(ea).toMatchObject({ status: 'CANCELLED', timeframe: 'cancelled' }); // even though its dates are upcoming
    expect(eb).toMatchObject({ status: 'COMPLETED', timeframe: 'completed' }); // even though its end date is in the future
  });
});

describe('event history (FR-197 – FR-199)', () => {
  it('shows a readable, newest-first timeline of who did what', async () => {
    const { owner, co, api } = await publishedEvent({ start: 5, end: 10, activities: [{ name: 'Talk', start: 5, end: 6 }], coAdmin: true });
    await owner.client.post(api('/guests'), { guest: { name: 'Priya', email: 'priya@x.co' } });
    await co!.client.post(api('/guests/import'), { csv: 'Name,Email\nA,a@x.co\nB,b@x.co', mode: 'commit' });

    const res = await owner.client.get(api('/history'));
    expect(res.status).toBe(200);
    const lines = res.body.entries.map((e: { actor: string; summary: string }) => `${e.actor} ${e.summary}`);
    expect(lines.slice(0, 2)).toEqual(['Rohan CoAdmin imported 2 guests from a spreadsheet', 'Asha Owner added the guest Priya']);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Asha Owner created the event',
        'Asha Owner added the activity “Talk”',
        expect.stringMatching(/^Asha Owner invited .* as a co-admin$/),
        'Rohan CoAdmin accepted the invitation and became a co-admin',
        expect.stringMatching(/^Asha Owner submitted the event for publication \(version \d+\)$/),
        expect.stringMatching(/^Rohan CoAdmin gave the final approval — the event was published/),
      ]),
    );
  });

  it('filters by category (guests / activities / approvals …)', async () => {
    const { owner, api } = await publishedEvent({ start: 5, end: 10, activities: [{ name: 'Talk', start: 5, end: 6 }] });
    await owner.client.post(api('/guests'), { guest: { name: 'Priya', email: 'priya@x.co' } });

    const guests = (await owner.client.get(api('/history?category=guests'))).body.entries;
    expect(guests.map((e: { summary: string }) => e.summary)).toEqual(['added the guest Priya']);
    const activities = (await owner.client.get(api('/history?category=activity'))).body.entries;
    expect(activities.every((e: { category: string }) => e.category === 'activity')).toBe(true);
    expect(activities).toHaveLength(1);
    const approvals = (await owner.client.get(api('/history?category=approval'))).body.entries;
    expect(approvals.map((e: { summary: string }) => e.summary).join(' | ')).toMatch(/submitted the event for publication.*\| .*published|published.*\| .*submitted/);
    expect((await owner.client.get(api('/history?category=nonsense'))).status).toBe(400);
  });

  it('pages through long histories and is for organisers only', async () => {
    const { owner, api } = await publishedEvent({ start: 5, end: 10, activities: [{ name: 'Talk', start: 5, end: 6 }] });
    for (let i = 0; i < 4; i++) await owner.client.post(api('/guests'), { guest: { name: `G${i}`, email: `g${i}@x.co` } });
    const first = (await owner.client.get(api('/history?limit=3'))).body;
    expect(first.entries).toHaveLength(3);
    const second = (await owner.client.get(api(`/history?limit=3&before=${first.nextCursor}`))).body;
    expect(second.entries[0].id).not.toBe(first.entries[2].id);

    const stranger = await signedInUser(app);
    expect((await stranger.client.get(api('/history'))).status).toBe(404);
  });
});
