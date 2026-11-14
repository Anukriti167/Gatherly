import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashToken } from '../../src/lib/crypto.ts';
import { createLogger } from '../../src/lib/logger.ts';
import { OutboxService } from '../../src/modules/outbox/outbox.service.ts';
import { browser, createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer, config } = createTestContext();
const outbox = new OutboxService(prisma, mailer, createLogger(config), 100);

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

const in_ = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 16);

/** Published event with Sangeet (capacity 1, deadline in 5 days) and Reception; guests Priya (Sangeet) and Anil (all). */
async function setup() {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (await owner.client.post('/api/v1/events', { name: 'Wedding', eventType: 'WEDDING', timezone: 'UTC', startsAt: in_(10), endsAt: in_(12) })).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  const sangeet = (await owner.client.post(api('/activities'), { activity: { name: 'Sangeet', timezone: 'UTC', startsAt: in_(10), endsAt: in_(10.2), capacity: 1, rsvpDeadline: in_(5), venueName: 'Taj' } })).body.activity.id as string;
  const reception = (await owner.client.post(api('/activities'), { activity: { name: 'Reception', timezone: 'UTC', startsAt: in_(11), endsAt: in_(11.2) } })).body.activity.id as string;
  const priya = (await owner.client.post(api('/guests'), { guest: { name: 'Priya Shah', email: 'priya@x.co', activityIds: [sangeet] } })).body.guest;
  const anil = (await owner.client.post(api('/guests'), { guest: { name: 'Anil Rao', email: 'anil@x.co', allActivities: true } })).body.guest;
  await owner.client.post(api('/publication/submit'), { expectedVersion: (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version });

  // Give each guest a live guest session via a known link token.
  const sessionFor = async (guestId: string, token: string) => {
    await prisma.invitation.create({ data: { eventId, guestId, tokenHash: hashToken(token), lastSentAt: new Date() } });
    const c = browser(app);
    expect((await c.post('/api/v1/guest/session', { token })).status).toBe(204);
    return c;
  };
  const priyaC = await sessionFor(priya.id, 'p'.repeat(43));
  const anilC = await sessionFor(anil.id, 'a'.repeat(43));
  mailer.clear();
  return { owner, eventId, api, sangeet, reception, priya, anil, priyaC, anilC };
}

const rsvp = (c: ReturnType<typeof browser>, activityId: string, status: string) => c.put(`/api/v1/guest/rsvps/${activityId}`, { status });

describe('guests answering (FR-109 – FR-114, FR-117)', () => {
  it('confirms, changes the answer, and returns the refreshed page', async () => {
    const { sangeet, priyaC } = await setup();
    const yes = await rsvp(priyaC, sangeet, 'CONFIRMED');
    expect(yes.status).toBe(200);
    expect(yes.body.view.activities[0]).toMatchObject({ id: sangeet, rsvp: 'CONFIRMED' });

    const no = await rsvp(priyaC, sangeet, 'DECLINED');
    expect(no.body.view.activities[0].rsvp).toBe('DECLINED');
    expect(await prisma.rsvp.count()).toBe(1); // one answer per guest per activity (FR-111)
  });

  it('emails the guest a confirmation through the queue', async () => {
    const { sangeet, priyaC } = await setup();
    await rsvp(priyaC, sangeet, 'CONFIRMED');
    await outbox.processBatch();
    const mail = mailer.lastTo('priya@x.co')!;
    expect(mail.subject).toBe('Confirmed: Sangeet · Wedding');
    expect(mail.text).toContain("You're confirmed for Sangeet");
  });

  it('cannot answer for activities they are not invited to (FR-114)', async () => {
    const { reception, priyaC } = await setup();
    const res = await rsvp(priyaC, reception, 'CONFIRMED');
    expect(res.status).toBe(404);
  });

  it('rejects other values and requires a guest session', async () => {
    const { sangeet, priyaC } = await setup();
    expect((await rsvp(priyaC, sangeet, 'PENDING')).status).toBe(400);
    expect((await rsvp(browser(app), sangeet, 'CONFIRMED')).status).toBe(401);
  });

  it('closes after the RSVP deadline (FR-113, FR-119)', async () => {
    const { sangeet, priyaC } = await setup();
    await prisma.activity.update({ where: { id: sangeet }, data: { rsvpDeadline: new Date(Date.now() - 1000) } });
    const res = await rsvp(priyaC, sangeet, 'CONFIRMED');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/deadline/);
    const view = (await priyaC.get('/api/v1/guest/event')).body.view;
    expect(view.activities[0].rsvpOpen).toBe(false);
  });

  it('respects capacity, even when two guests confirm at the same moment (FR-022)', async () => {
    const { sangeet, priyaC, anilC } = await setup();
    const results = await Promise.all([rsvp(priyaC, sangeet, 'CONFIRMED'), rsvp(anilC, sangeet, 'CONFIRMED')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.rsvp.count({ where: { activityId: sangeet, status: 'CONFIRMED' } })).toBe(1);

    const loser = results.find((r) => r.status === 409)!;
    expect(loser.body.error.code).toBe('ACTIVITY_FULL');
  });

  it('a guest can still decline a full activity, and the page shows it as full', async () => {
    const { sangeet, priyaC, anilC } = await setup();
    await rsvp(priyaC, sangeet, 'CONFIRMED');
    const anilView = (await anilC.get('/api/v1/guest/event')).body.view;
    expect(anilView.activities.find((a: { id: string }) => a.id === sangeet)).toMatchObject({ full: true });
    expect((await rsvp(anilC, sangeet, 'DECLINED')).status).toBe(200);
  });
});

describe('organisers (FR-115, FR-116, FR-118)', () => {
  it('see counts per activity and each guest\'s answers', async () => {
    const { owner, api, sangeet, reception, priya, anil, priyaC, anilC } = await setup();
    await rsvp(priyaC, sangeet, 'CONFIRMED');
    await rsvp(anilC, reception, 'DECLINED');

    const overview = (await owner.client.get(api('/rsvps'))).body;
    expect(overview.activities).toEqual([
      { activityId: sangeet, invited: 2, confirmed: 1, declined: 0, pending: 1, capacity: 1 },
      { activityId: reception, invited: 1, confirmed: 0, declined: 1, pending: 0, capacity: null },
    ]);
    expect(overview.answers).toEqual({ [priya.id]: { [sangeet]: 'CONFIRMED' }, [anil.id]: { [reception]: 'DECLINED' } });
  });

  it('get an in-app notification (no email flood) and a history entry', async () => {
    const { owner, eventId, api, sangeet, priyaC } = await setup();
    await rsvp(priyaC, sangeet, 'CONFIRMED');

    const box = (await owner.client.get('/api/v1/me/notifications')).body;
    expect(box.notifications[0]).toMatchObject({ kind: 'rsvp.updated', title: 'Priya Shah is going to Sangeet', url: `/events/${eventId}?tab=guests` });
    expect(mailer.lastTo(owner.email)).toBeUndefined();

    const history = (await owner.client.get(api('/history?category=guests'))).body.entries;
    expect(`${history[0].actor} ${history[0].summary}`).toBe('Priya Shah replied “Going” to Sangeet');
  });

  it('answering the same thing twice changes nothing and notifies no one', async () => {
    const { owner, sangeet, priyaC } = await setup();
    await rsvp(priyaC, sangeet, 'CONFIRMED');
    await rsvp(priyaC, sangeet, 'CONFIRMED');
    const n = (await owner.client.get('/api/v1/me/notifications')).body.notifications.filter((x: { kind: string }) => x.kind === 'rsvp.updated');
    expect(n).toHaveLength(1);
  });

  it('non-members cannot see RSVPs', async () => {
    const { api } = await setup();
    const stranger = await signedInUser(app);
    expect((await stranger.client.get(api('/rsvps'))).status).toBe(404);
  });
});

describe('calendar export (FR-190, FR-191)', () => {
  it('downloads the guest\'s own activities as .ics', async () => {
    const { anilC, priyaC, sangeet } = await setup();
    const all = await anilC.get('/api/v1/guest/calendar.ics');
    expect(all.status).toBe(200);
    expect(all.headers['content-type']).toMatch(/text\/calendar/);
    expect(all.headers['content-disposition']).toMatch(/attachment; filename="wedding\.ics"/);
    expect(all.text.match(/BEGIN:VEVENT/g)).toHaveLength(2);

    const one = await priyaC.get(`/api/v1/guest/calendar.ics?activityId=${sangeet}`);
    expect(one.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(one.text).toContain('SUMMARY:Sangeet · Wedding');
    expect(one.headers['content-disposition']).toMatch(/sangeet\.ics/);
  });

  it('never includes activities the guest is not invited to', async () => {
    const { priyaC, reception } = await setup();
    const all = await priyaC.get('/api/v1/guest/calendar.ics');
    expect(all.text).not.toContain('Reception');
    expect((await priyaC.get(`/api/v1/guest/calendar.ics?activityId=${reception}`)).status).toBe(404);
  });
});
