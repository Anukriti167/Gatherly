import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { browser, createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma } = createTestContext();
const API = '/api/v1/events';

const wedding = {
  name: 'Asha & Rohan Wedding',
  eventType: 'WEDDING',
  timezone: 'Asia/Kolkata',
  startsAt: '2027-02-12T10:00',
  endsAt: '2027-02-14T23:00',
};

beforeEach(() => resetDatabase(prisma));
afterAll(() => prisma.$disconnect());

describe('creating events (FR-008, FR-009, FR-014, FR-060)', () => {
  it('creates a Draft owned by the creator, storing UTC and the timezone', async () => {
    const { client, user } = await signedInUser(app);
    const res = await client.post(API, wedding);

    expect(res.status).toBe(201);
    expect(res.body.event).toMatchObject({
      name: wedding.name,
      status: 'DRAFT',
      role: 'OWNER',
      version: 1,
      timezone: 'Asia/Kolkata',
      startsAt: '2027-02-12T04:30:00.000Z', // 10:00 IST
      startsAtLocal: '2027-02-12T10:00',
      timeframe: 'upcoming',
    });
    expect(res.body.event.allowedActions).toEqual(expect.arrayContaining(['event.edit', 'publication.submit', 'coadmins.manage']));
    expect(res.body.event.allowedActions).not.toContain('invitations.send'); // FR-226

    const owners = await prisma.eventMembership.findMany({ where: { eventId: res.body.event.id, role: 'OWNER' } });
    expect(owners).toHaveLength(1);
    expect(owners[0]!.userId).toBe(user.id);
  });

  it('records creation in the audit log with the actor (FR-197, FR-198)', async () => {
    const { client, user } = await signedInUser(app);
    const { body } = await client.post(API, wedding);
    const log = await prisma.auditLog.findMany({ where: { eventId: body.event.id } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ action: 'event.created', actorType: 'USER', actorUserId: user.id });
  });

  it('validates input and returns field errors', async () => {
    const { client } = await signedInUser(app);
    const res = await client.post(API, { ...wedding, name: '', endsAt: '2027-02-11T10:00' });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('name');
    expect(res.body.error.fields).toHaveProperty('endsAt');
  });

  it('rejects a wall-clock time that does not exist in the timezone', async () => {
    const { client } = await signedInUser(app);
    const res = await client.post(API, {
      ...wedding,
      timezone: 'America/New_York',
      startsAt: '2027-03-14T02:30', // skipped by DST
      endsAt: '2027-03-14T05:00',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.fields).toHaveProperty('startsAt');
  });

  it('requires sign-in', async () => {
    expect((await browser(app).post(API, wedding)).status).toBe(401);
  });

  it('cannot create a second ACTIVE owner (database constraint, FR-060)', async () => {
    const { client } = await signedInUser(app);
    const other = await signedInUser(app);
    const { body } = await client.post(API, wedding);
    await expect(
      prisma.eventMembership.create({
        data: { eventId: body.event.id, userId: other.user.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    ).rejects.toThrow();
  });
});

describe('viewing and listing (FR-006, FR-007, FR-200)', () => {
  it('lists only events the user belongs to, with role and timeframe', async () => {
    const asha = await signedInUser(app);
    const ravi = await signedInUser(app);
    await asha.client.post(API, wedding);
    await asha.client.post(API, { ...wedding, name: 'Past Workshop', eventType: 'WORKSHOP', startsAt: '2025-01-10T09:00', endsAt: '2025-01-10T17:00' });
    await ravi.client.post(API, { ...wedding, name: 'Ravi Birthday', eventType: 'BIRTHDAY' });

    const res = await asha.client.get(API);
    expect(res.status).toBe(200);
    const names = res.body.events.map((e: { name: string }) => e.name);
    expect(names).toEqual(['Past Workshop', 'Asha & Rohan Wedding']); // sorted by start
    expect(res.body.events[0]).toMatchObject({ timeframe: 'completed', role: 'OWNER' });
    expect(res.body.events[1]).toMatchObject({ timeframe: 'upcoming' });
  });

  it('returns 404 (not 403) for events the user is not part of', async () => {
    const asha = await signedInUser(app);
    const stranger = await signedInUser(app);
    const { body } = await asha.client.post(API, wedding);
    const res = await stranger.client.get(`${API}/${body.event.id}`);
    expect(res.status).toBe(404);
  });
});

describe('editing (FR-013, FR-016, FR-067, FR-199, FR-221)', () => {
  it('lets the owner edit a draft, bumps the version and audits the change', async () => {
    const { client } = await signedInUser(app);
    const { body } = await client.post(API, wedding);
    const id = body.event.id;

    const res = await client.patch(`${API}/${id}`, {
      changes: { description: 'Three days of celebrations', startsAt: '2027-02-12T11:00', endsAt: '2027-02-14T23:00', timezone: 'Asia/Kolkata' },
      expectedVersion: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ version: 2, description: 'Three days of celebrations', startsAtLocal: '2027-02-12T11:00' });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { eventId: id, action: 'event.updated' } });
    expect(entry.before).toMatchObject({ description: '' });
    expect(entry.after).toMatchObject({ description: 'Three days of celebrations' });
    expect(entry.metadata).toMatchObject({ fromVersion: 1 });
  });

  it('lets an active co-admin edit a draft without approval (FR-221)', async () => {
    const owner = await signedInUser(app);
    const coadmin = await signedInUser(app);
    const { body } = await owner.client.post(API, wedding);
    // Direct insert until the co-admin invitation flow exists.
    await prisma.eventMembership.create({
      data: { eventId: body.event.id, userId: coadmin.user.id, role: 'CO_ADMIN', status: 'ACTIVE' },
    });

    const res = await coadmin.client.patch(`${API}/${body.event.id}`, { changes: { name: 'Renamed by co-admin' } });
    expect(res.status).toBe(200);
    expect(res.body.event).toMatchObject({ name: 'Renamed by co-admin', role: 'CO_ADMIN' });
    expect(res.body.event.allowedActions).not.toContain('coadmins.manage'); // FR-064
  });

  it('does not let a removed co-admin or a stranger edit', async () => {
    const owner = await signedInUser(app);
    const removed = await signedInUser(app);
    const stranger = await signedInUser(app);
    const { body } = await owner.client.post(API, wedding);
    await prisma.eventMembership.create({
      data: { eventId: body.event.id, userId: removed.user.id, role: 'CO_ADMIN', status: 'REMOVED' },
    });

    for (const c of [removed.client, stranger.client]) {
      expect((await c.patch(`${API}/${body.event.id}`, { changes: { name: 'Hacked' } })).status).toBe(404);
    }
    const event = await prisma.event.findUniqueOrThrow({ where: { id: body.event.id } });
    expect(event.name).toBe(wedding.name);
  });

  it('rejects stale edits (someone else saved first)', async () => {
    const { client } = await signedInUser(app);
    const { body } = await client.post(API, wedding);
    await client.patch(`${API}/${body.event.id}`, { changes: { name: 'First edit' }, expectedVersion: 1 });
    const res = await client.patch(`${API}/${body.event.id}`, { changes: { name: 'Second edit' }, expectedVersion: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STALE_VERSION');
  });

  it('blocks direct edits once published — changes need a proposal', async () => {
    const { client } = await signedInUser(app);
    const { body } = await client.post(API, wedding);
    await prisma.event.update({ where: { id: body.event.id }, data: { status: 'PUBLISHED' } });

    const res = await client.patch(`${API}/${body.event.id}`, { changes: { name: 'Sneaky change' } });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/change proposal/);
  });

  it('does not bump the version when nothing actually changed', async () => {
    const { client } = await signedInUser(app);
    const { body } = await client.post(API, wedding);
    const res = await client.patch(`${API}/${body.event.id}`, { changes: { name: wedding.name } });
    expect(res.body.event.version).toBe(1);
  });
});
