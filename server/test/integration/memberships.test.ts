import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer } = createTestContext();
const event = { name: 'Wedding', eventType: 'WEDDING', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' };

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

async function setup() {
  const owner = await signedInUser(app, 'Asha Owner');
  const friend = await signedInUser(app, 'Rohan Friend');
  const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
  return { owner, friend, eventId, members: `/api/v1/events/${eventId}/members` };
}

describe('inviting co-admins (FR-062)', () => {
  it('owner invites a registered user, who gets an email and sees it on their dashboard', async () => {
    const { owner, friend, eventId, members } = await setup();

    const res = await owner.client.post(members, { email: friend.email.toUpperCase() });
    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({ name: 'Rohan Friend', role: 'CO_ADMIN', status: 'INVITED', invitedByName: 'Asha Owner' });

    const mail = mailer.lastTo(friend.email);
    expect(mail?.subject).toContain('co-organise “Wedding”');
    expect(mail?.text).toContain('/dashboard');

    const inv = await friend.client.get('/api/v1/invitations');
    expect(inv.body.invitations).toEqual([expect.objectContaining({ eventId, eventName: 'Wedding', invitedByName: 'Asha Owner' })]);

    // Pending invitees can't open the event yet.
    expect((await friend.client.get(`/api/v1/events/${eventId}`)).status).toBe(404);
  });

  it('explains when the email has no Gatherly account', async () => {
    const { owner, members } = await setup();
    const res = await owner.client.post(members, { email: 'nobody@example.com' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('rejects inviting yourself, duplicates and existing co-admins', async () => {
    const { owner, friend, members } = await setup();
    expect((await owner.client.post(members, { email: owner.email })).status).toBe(400);
    await owner.client.post(members, { email: friend.email });
    expect((await owner.client.post(members, { email: friend.email })).status).toBe(409);
  });

  it('only the owner can invite (FR-064)', async () => {
    const { owner, friend, eventId, members } = await setup();
    await owner.client.post(members, { email: friend.email });
    await friend.client.post(`${members}/me/accept`);
    const third = await signedInUser(app);
    const res = await friend.client.post(members, { email: third.email });
    expect(res.status).toBe(403);
    expect(await prisma.eventMembership.count({ where: { eventId } })).toBe(2);
  });

  it('records invitations in the audit log', async () => {
    const { owner, friend, eventId, members } = await setup();
    await owner.client.post(members, { email: friend.email });
    expect(await prisma.auditLog.count({ where: { eventId, action: 'coadmin.invited' } })).toBe(1);
  });
});

describe('responding to an invitation', () => {
  it('accepting grants co-admin access with edit rights but not organiser management', async () => {
    const { owner, friend, eventId, members } = await setup();
    await owner.client.post(members, { email: friend.email });

    expect((await friend.client.post(`${members}/me/accept`)).status).toBe(204);
    const ev = await friend.client.get(`/api/v1/events/${eventId}`);
    expect(ev.status).toBe(200);
    expect(ev.body.event.role).toBe('CO_ADMIN');
    expect(ev.body.event.allowedActions).toContain('event.edit'); // FR-221
    expect(ev.body.event.allowedActions).not.toContain('coadmins.manage'); // FR-064

    const dash = await friend.client.get('/api/v1/events');
    expect(dash.body.events).toEqual([expect.objectContaining({ id: eventId, role: 'CO_ADMIN' })]);
    expect((await friend.client.get('/api/v1/invitations')).body.invitations).toEqual([]);
  });

  it('declining keeps them out; the invitation cannot be used twice', async () => {
    const { owner, friend, eventId, members } = await setup();
    await owner.client.post(members, { email: friend.email });
    expect((await friend.client.post(`${members}/me/decline`)).status).toBe(204);
    expect((await friend.client.get(`/api/v1/events/${eventId}`)).status).toBe(404);
    expect((await friend.client.post(`${members}/me/accept`)).status).toBe(404);
  });

  it('a user without an invitation cannot accept their way in', async () => {
    const { eventId } = await setup();
    const stranger = await signedInUser(app);
    expect((await stranger.client.post(`/api/v1/events/${eventId}/members/me/accept`)).status).toBe(404);
  });

  it('can re-invite someone who declined', async () => {
    const { owner, friend, members } = await setup();
    await owner.client.post(members, { email: friend.email });
    await friend.client.post(`${members}/me/decline`);
    const again = await owner.client.post(members, { email: friend.email });
    expect(again.status).toBe(201);
    expect(again.body.member.status).toBe('INVITED');
  });
});

describe('listing and removing organisers (FR-063)', () => {
  it('lists the owner first, then co-admins and pending invites, marking "you"', async () => {
    const { owner, friend, members } = await setup();
    const third = await signedInUser(app, 'Priya Pending');
    await owner.client.post(members, { email: friend.email });
    await friend.client.post(`${members}/me/accept`);
    await owner.client.post(members, { email: third.email });

    const res = await friend.client.get(members);
    expect(res.body.members.map((m: { name: string; status: string; isYou: boolean }) => [m.name, m.status, m.isYou])).toEqual([
      ['Asha Owner', 'ACTIVE', false],
      ['Rohan Friend', 'ACTIVE', true],
      ['Priya Pending', 'INVITED', false],
    ]);
  });

  it('owner removes a co-admin: access ends immediately and they are emailed', async () => {
    const { owner, friend, eventId, members } = await setup();
    const invited = (await owner.client.post(members, { email: friend.email })).body.member;
    await friend.client.post(`${members}/me/accept`);
    mailer.clear();

    expect((await owner.client.delete(`${members}/${invited.id}`)).status).toBe(204);
    expect((await friend.client.get(`/api/v1/events/${eventId}`)).status).toBe(404);
    expect(mailer.lastTo(friend.email)?.subject).toMatch(/access .* has ended/);
    expect(await prisma.auditLog.count({ where: { eventId, action: 'coadmin.removed' } })).toBe(1);
  });

  it('owner can cancel a pending invitation', async () => {
    const { owner, friend, members } = await setup();
    const invited = (await owner.client.post(members, { email: friend.email })).body.member;
    expect((await owner.client.delete(`${members}/${invited.id}`)).status).toBe(204);
    expect((await friend.client.get('/api/v1/invitations')).body.invitations).toEqual([]);
    expect((await friend.client.post(`${members}/me/accept`)).status).toBe(404);
  });

  it('co-admins cannot remove anyone, and the owner cannot be removed', async () => {
    const { owner, friend, members } = await setup();
    const invited = (await owner.client.post(members, { email: friend.email })).body.member;
    await friend.client.post(`${members}/me/accept`);
    const list = (await owner.client.get(members)).body.members as { id: string; role: string }[];
    const ownerRow = list.find((m) => m.role === 'OWNER')!;

    expect((await friend.client.delete(`${members}/${ownerRow.id}`)).status).toBe(403);
    expect((await friend.client.delete(`${members}/${invited.id}`)).status).toBe(403);
    expect((await owner.client.delete(`${members}/${ownerRow.id}`)).status).toBe(403);
  });

  it('non-members cannot see the organiser list', async () => {
    const { members } = await setup();
    const stranger = await signedInUser(app);
    expect((await stranger.client.get(members)).status).toBe(404);
  });
});
