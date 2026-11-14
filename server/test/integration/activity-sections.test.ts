import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma } = createTestContext();

const event = { name: 'Wedding', eventType: 'WEDDING', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' };
const basics = { name: 'Sangeet', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T19:00', endsAt: '2027-02-12T23:30' };

const itinerary = [
  { title: 'Dinner & DJ', startsAt: '2027-02-12T21:00', endsAt: '2027-02-12T22:30' },
  { title: 'Guests arrive', description: 'Welcome drinks at the lawn', startsAt: '2027-02-12T19:00' },
  { title: 'Family performances', startsAt: '2027-02-12T19:45' },
];
const menu = [
  {
    name: 'Starters',
    items: [
      { name: 'Paneer tikka', dietaryTags: ['vegetarian', 'Spicy', 'spicy'] },
      { name: 'Chicken 65', dietaryTags: ['non-vegetarian'] },
    ],
  },
  { name: 'Desserts', items: [{ name: 'Gulab jamun', description: 'Served warm', dietaryTags: ['vegetarian', 'contains-dairy'] }] },
];
const people = [
  { role: 'PERFORMER', name: 'DJ Riya', title: 'DJ' },
  { role: 'PARTICIPANT', name: 'Bride’s cousins', title: 'Group dance' },
];

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

async function setup() {
  const owner = await signedInUser(app);
  const { body } = await owner.client.post('/api/v1/events', event);
  const base = `/api/v1/events/${body.event.id}/activities`;
  return { ...owner, eventId: body.event.id as string, base };
}

describe('saving itinerary, menu and people with the activity (single page)', () => {
  it('creates everything in one request and bumps the version once', async () => {
    const { client, base, eventId } = await setup();
    const res = await client.post(base, { activity: { ...basics, itinerary, menu, people }, expectedVersion: 1 });

    expect(res.status).toBe(201);
    const a = res.body.activity;
    // FR-028: itinerary shown chronologically regardless of input order
    expect(a.itinerary.map((i: { title: string }) => i.title)).toEqual(['Guests arrive', 'Family performances', 'Dinner & DJ']);
    expect(a.itinerary[0]).toMatchObject({ startsAtLocal: '2027-02-12T19:00', endsAtLocal: null, description: 'Welcome drinks at the lawn' });
    expect(a.itinerary[2]).toMatchObject({ startsAt: '2027-02-12T15:30:00.000Z', endsAtLocal: '2027-02-12T22:30' });

    // FR-030/031: categories in order, tags normalised and de-duplicated
    expect(a.menu.map((c: { name: string }) => c.name)).toEqual(['Starters', 'Desserts']);
    expect(a.menu[0].items[0]).toMatchObject({ name: 'Paneer tikka', dietaryTags: ['vegetarian', 'spicy'] });
    expect(a.menu[1].items[0]).toMatchObject({ description: 'Served warm' });

    // FR-023
    expect(a.people).toEqual([
      expect.objectContaining({ role: 'PERFORMER', name: 'DJ Riya', title: 'DJ' }),
      expect.objectContaining({ role: 'PARTICIPANT', name: 'Bride’s cousins' }),
    ]);

    expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version).toBe(2);
  });

  it('keeps entries at the same time in the order given (FR-027 tie-break)', async () => {
    const { client, base } = await setup();
    const res = await client.post(base, {
      activity: {
        ...basics,
        itinerary: [
          { title: 'Speech by father', startsAt: '2027-02-12T20:00' },
          { title: 'Speech by mother', startsAt: '2027-02-12T20:00' },
        ],
      },
    });
    expect(res.body.activity.itinerary.map((i: { title: string }) => i.title)).toEqual(['Speech by father', 'Speech by mother']);
  });

  it('replaces lists on update, leaves omitted lists untouched, and audits readable summaries', async () => {
    const { client, base, eventId } = await setup();
    const created = (await client.post(base, { activity: { ...basics, itinerary, menu, people } })).body.activity;

    const res = await client.patch(`${base}/${created.id}`, {
      changes: { itinerary: [{ title: 'Doors open', startsAt: '2027-02-12T18:30' }] },
    });
    expect(res.status).toBe(200);
    expect(res.body.activity.itinerary.map((i: { title: string }) => i.title)).toEqual(['Doors open']);
    expect(res.body.activity.menu).toHaveLength(2); // untouched
    expect(res.body.activity.people).toHaveLength(2); // untouched

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: 'activity.updated' } });
    expect(entry.after).toEqual({ itinerary: ['18:30 Doors open'] });
    expect((entry.before as { itinerary: string[] }).itinerary).toEqual(['19:00 Guests arrive', '19:45 Family performances', '21:00 Dinner & DJ']);
  });

  it('clears a section when an empty list is sent', async () => {
    const { client, base } = await setup();
    const created = (await client.post(base, { activity: { ...basics, menu } })).body.activity;
    const res = await client.patch(`${base}/${created.id}`, { changes: { menu: [] } });
    expect(res.body.activity.menu).toEqual([]);
    expect(await prisma.menuItem.count()).toBe(0); // items removed with their categories
  });

  it('removes all nested data when the activity is deleted', async () => {
    const { client, base } = await setup();
    const created = (await client.post(base, { activity: { ...basics, itinerary, menu, people } })).body.activity;
    await client.delete(`${base}/${created.id}`);
    expect(await prisma.itineraryItem.count()).toBe(0);
    expect(await prisma.menuCategory.count()).toBe(0);
    expect(await prisma.activityPerson.count()).toBe(0);
  });
});

describe('validation of nested sections', () => {
  it('reports errors on the exact row and field', async () => {
    const { client, base } = await setup();
    const res = await client.post(base, {
      activity: {
        ...basics,
        itinerary: [{ title: 'Ok', startsAt: '2027-02-12T19:00' }, { title: '', startsAt: '2027-02-12T20:00', endsAt: '2027-02-12T19:00' }],
        menu: [{ name: 'Starters', items: [{ name: '', dietaryTags: ['<script>'] }] }],
        people: [{ role: 'JUGGLER', name: 'X' }],
      },
    });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fields)).toEqual(
      expect.arrayContaining([
        'activity.itinerary.1.title',
        'activity.itinerary.1.endsAt',
        'activity.menu.0.items.0.name',
        'activity.menu.0.items.0.dietaryTags.0',
        'activity.people.0.role',
      ]),
    );
  });

  it('rejects an itinerary time skipped by daylight saving, pointing at the row', async () => {
    const owner = await signedInUser(app);
    const ev = (await owner.client.post('/api/v1/events', { ...event, timezone: 'America/New_York' })).body.event;
    const res = await owner.client.post(`/api/v1/events/${ev.id}/activities`, {
      activity: {
        name: 'Brunch',
        timezone: 'America/New_York',
        startsAt: '2027-03-14T01:00',
        endsAt: '2027-03-14T05:00',
        itinerary: [{ title: 'Toast', startsAt: '2027-03-14T02:30' }],
      },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty(['itinerary.0.startsAt']);
  });

  it('blocks nested changes once the event is published', async () => {
    const { client, base, eventId } = await setup();
    const created = (await client.post(base, { activity: { ...basics, menu } })).body.activity;
    await prisma.event.update({ where: { id: eventId }, data: { status: 'PUBLISHED' } });
    const res = await client.patch(`${base}/${created.id}`, { changes: { menu: [] } });
    expect(res.status).toBe(403);
    expect(await prisma.menuCategory.count()).toBe(2);
  });
});
