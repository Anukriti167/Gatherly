import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma } = createTestContext();

const wedding = { name: 'Wedding', eventType: 'WEDDING', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' };
const sangeet = {
  name: 'Sangeet',
  timezone: 'Asia/Kolkata',
  startsAt: '2027-02-12T19:00',
  endsAt: '2027-02-12T23:30',
  venueName: 'Taj Lands End',
  venueAddress: 'Bandstand, Bandra West, Mumbai',
  capacity: 150,
  rsvpDeadline: '2027-02-05T23:59',
  dressCode: 'Indo-western, bright colours',
  themeColors: ['#F59E0B', '#DB2777'],
};

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

async function ownerWithEvent() {
  const owner = await signedInUser(app);
  const { body } = await owner.client.post('/api/v1/events', wedding);
  const eventId = body.event.id as string;
  return { ...owner, eventId, base: `/api/v1/events/${eventId}/activities` };
}

const versionOf = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;

describe('creating activities (FR-012, FR-019 – FR-022)', () => {
  it('adds an activity with its own times, venue, capacity and deadline', async () => {
    const { client, base, eventId } = await ownerWithEvent();
    const res = await client.post(base, { activity: sangeet, expectedVersion: 1 });

    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({
      name: 'Sangeet',
      status: 'SCHEDULED',
      startsAt: '2027-02-12T13:30:00.000Z',
      startsAtLocal: '2027-02-12T19:00',
      capacity: 150,
      rsvpDeadlineLocal: '2027-02-05T23:59',
      themeColors: ['#F59E0B', '#DB2777'],
      showMenu: true,
    });
    expect(res.body.activity.mapsUrl).toBe(
      'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('Bandstand, Bandra West, Mumbai'), // the Location is the search; the venue name is just a label
    );
    // Any activity change is an event edit → version bump (approvals bind to versions).
    expect(await versionOf(eventId)).toBe(2);
  });

  it('supports a different timezone per activity and coordinates for maps', async () => {
    const { client, base } = await ownerWithEvent();
    const res = await client.post(base, {
      activity: {
        name: 'Destination reception',
        timezone: 'Asia/Dubai',
        startsAt: '2027-02-20T20:00',
        endsAt: '2027-02-20T23:00',
        venueLatitude: 25.1972,
        venueLongitude: 55.2744,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.activity.startsAt).toBe('2027-02-20T16:00:00.000Z');
    expect(res.body.activity.mapsUrl).toBe('https://www.google.com/maps/search/?api=1&query=25.1972%2C55.2744');
  });

  it('allows a virtual-only activity with an https meeting link (FR-193)', async () => {
    const { client, base } = await ownerWithEvent();
    const res = await client.post(base, {
      activity: { name: 'Live stream', timezone: 'Asia/Kolkata', startsAt: '2027-02-13T11:00', endsAt: '2027-02-13T13:00', virtualMeetingUrl: 'https://meet.example.com/abc' },
    });
    expect(res.status).toBe(201);
    expect(res.body.activity.mapsUrl).toBeNull();
  });

  it('rejects unsafe links, bad times, deadline after start and half coordinates', async () => {
    const { client, base } = await ownerWithEvent();
    const res = await client.post(base, {
      activity: {
        ...sangeet,
        virtualMeetingUrl: 'javascript:alert(1)',
        endsAt: '2027-02-12T18:00',
        rsvpDeadline: '2027-02-13T10:00',
        venueLatitude: 19.0,
        capacity: 0,
      },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining(['activity.virtualMeetingUrl', 'activity.endsAt', 'activity.rsvpDeadline', 'activity.venueLongitude', 'activity.capacity']),
    );
  });

  it('accepts form-style values: empty strings clear optional fields, numbers as strings', async () => {
    const { client, base } = await ownerWithEvent();
    const res = await client.post(base, {
      activity: { ...sangeet, capacity: '80', venueAddress: '', rsvpDeadline: '', virtualMeetingUrl: '' },
    });
    expect(res.status).toBe(201);
    expect(res.body.activity).toMatchObject({ capacity: 80, venueAddress: null, rsvpDeadline: null, virtualMeetingUrl: null });
  });
});

describe('listing, editing and removing (FR-013, FR-036)', () => {
  it('lists activities in chronological order', async () => {
    const { client, base } = await ownerWithEvent();
    await client.post(base, { activity: { ...sangeet, name: 'Reception', startsAt: '2027-02-14T19:00', endsAt: '2027-02-14T23:00', rsvpDeadline: '' } });
    await client.post(base, { activity: { ...sangeet, name: 'Haldi', startsAt: '2027-02-12T10:00', endsAt: '2027-02-12T13:00', rsvpDeadline: '' } });
    await client.post(base, { activity: sangeet });

    const res = await client.get(base);
    expect(res.body.activities.map((a: { name: string }) => a.name)).toEqual(['Haldi', 'Sangeet', 'Reception']);
  });

  it('edits one activity without touching others, audits only what changed', async () => {
    const { client, base, eventId } = await ownerWithEvent();
    const a = (await client.post(base, { activity: sangeet })).body.activity;
    const b = (await client.post(base, { activity: { ...sangeet, name: 'Mehendi', rsvpDeadline: '' } })).body.activity;

    const res = await client.patch(`${base}/${a.id}`, { changes: { dressCode: 'All white', showMenu: false } });
    expect(res.status).toBe(200);
    expect(res.body.activity).toMatchObject({ dressCode: 'All white', showMenu: false, name: 'Sangeet' });

    const other = (await client.get(`${base}/${b.id}`)).body.activity;
    expect(other.dressCode).toBe(sangeet.dressCode);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: 'activity.updated' } });
    expect(entry.after).toEqual({ dressCode: 'All white', showMenu: false });
  });

  it('moves the RSVP deadline alone, validated against the existing start', async () => {
    const { client, base } = await ownerWithEvent();
    const a = (await client.post(base, { activity: sangeet })).body.activity;
    const ok = await client.patch(`${base}/${a.id}`, { changes: { rsvpDeadline: '2027-02-10T12:00' } });
    expect(ok.body.activity.rsvpDeadlineLocal).toBe('2027-02-10T12:00');
    const late = await client.patch(`${base}/${a.id}`, { changes: { rsvpDeadline: '2027-02-12T20:00' } });
    expect(late.status).toBe(400);
  });

  it('removes an activity from a draft and records it', async () => {
    const { client, base, eventId } = await ownerWithEvent();
    const a = (await client.post(base, { activity: sangeet })).body.activity;
    expect((await client.delete(`${base}/${a.id}`)).status).toBe(204);
    expect((await client.get(base)).body.activities).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { eventId, action: 'activity.deleted' } })).toBe(1);
  });

  it('rejects stale edits based on the event version', async () => {
    const { client, base } = await ownerWithEvent();
    const a = (await client.post(base, { activity: sangeet, expectedVersion: 1 })).body.activity; // → v2
    const res = await client.patch(`${base}/${a.id}`, { changes: { name: 'X' }, expectedVersion: 1 });
    expect(res.status).toBe(409);
  });
});

describe('access control (FR-016, FR-067, FR-200)', () => {
  it('hides activities from non-members', async () => {
    const { client, base } = await ownerWithEvent();
    const a = (await client.post(base, { activity: sangeet })).body.activity;
    const stranger = await signedInUser(app);
    expect((await stranger.client.get(base)).status).toBe(404);
    expect((await stranger.client.patch(`${base}/${a.id}`, { changes: { name: 'Hacked' } })).status).toBe(404);
    expect((await stranger.client.delete(`${base}/${a.id}`)).status).toBe(404);
  });

  it("can't reach another event's activity through your own event", async () => {
    const mine = await ownerWithEvent();
    const theirs = await ownerWithEvent();
    const foreign = (await theirs.client.post(theirs.base, { activity: sangeet })).body.activity;
    const res = await mine.client.patch(`${mine.base}/${foreign.id}`, { changes: { name: 'Hijacked' } });
    expect(res.status).toBe(404);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: foreign.id } })).name).toBe('Sangeet');
  });

  it('blocks direct activity changes once the event is published', async () => {
    const { client, base, eventId } = await ownerWithEvent();
    const a = (await client.post(base, { activity: sangeet })).body.activity;
    await prisma.event.update({ where: { id: eventId }, data: { status: 'PUBLISHED' } });

    expect((await client.post(base, { activity: { ...sangeet, name: 'New' } })).status).toBe(403);
    expect((await client.patch(`${base}/${a.id}`, { changes: { name: 'X' } })).status).toBe(403);
    expect((await client.delete(`${base}/${a.id}`)).status).toBe(403);
    expect((await client.get(base)).status).toBe(200); // still viewable
  });
});
