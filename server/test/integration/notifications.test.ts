import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer } = createTestContext();
const event = { name: 'Wedding', eventType: 'WEDDING', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' };
const activity = { name: 'Sangeet', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T19:00', endsAt: '2027-02-12T23:00' };

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

async function setup() {
  const owner = await signedInUser(app, 'Asha Owner');
  const co = await signedInUser(app, 'Rohan CoAdmin');
  const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  await owner.client.post(api('/activities'), { activity });
  await owner.client.post(api('/members'), { email: co.email });
  await co.client.post(api('/members/me/accept'));
  const version = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;
  return { owner, co, eventId, api, version };
}

const inbox = (c: Awaited<ReturnType<typeof signedInUser>>['client']) => c.get('/api/v1/me/notifications').then((r) => r.body);

describe('in-app notifications (FR-150, FR-160)', () => {
  it('every organiser email also appears in the bell, with a link into the app', async () => {
    const { owner, co, eventId, api } = await setup();
    await owner.client.post(api('/guests'), { guest: { name: 'Priya', email: 'priya@x.co', allActivities: true } });

    const box = await inbox(co.client);
    const n = box.notifications.find((x: { kind: string }) => x.kind === 'guests.changed');
    expect(n).toMatchObject({ eventId, eventName: 'Wedding', title: 'Asha Owner added a guest', url: `/events/${eventId}?tab=guests`, read: false });
    expect(n.body).toContain('Priya (priya@x.co)');
    expect(box.unreadCount).toBeGreaterThanOrEqual(1);
    // The person who made the change isn't notified.
    expect((await inbox(owner.client)).notifications.some((x: { kind: string }) => x.kind === 'guests.changed')).toBe(false);
  });

  it('co-admin invitations notify the invitee without linking into an event they cannot open yet', async () => {
    const owner = await signedInUser(app, 'Owner');
    const friend = await signedInUser(app, 'Friend');
    const id = (await owner.client.post('/api/v1/events', event)).body.event.id;
    await owner.client.post(`/api/v1/events/${id}/members`, { email: friend.email });

    const [n] = (await inbox(friend.client)).notifications;
    expect(n).toMatchObject({ kind: 'coadmin.invited', eventId: null, url: '/dashboard', title: 'Invitation to co-organise Wedding' });
  });

  it('publishing and proposals produce notifications for the right people', async () => {
    const { owner, co, api, version } = await setup();
    await owner.client.post(api('/publication/submit'), { expectedVersion: await version() });
    expect((await inbox(co.client)).notifications[0]).toMatchObject({ kind: 'publication.requested', title: 'Approval needed: publish Wedding' });

    await co.client.post(api('/publication/approve'), { expectedVersion: await version() });
    for (const u of [owner, co]) expect((await inbox(u.client)).notifications[0].kind).toBe('publication.published');

    const g = (await owner.client.post(api('/guests'), { guest: { name: 'Anil', email: 'anil@x.co' } })).body.guest;
    const p = (await owner.client.post(api('/proposals'), { title: 'Remove Anil', description: 'Cannot come', changes: [{ type: 'REMOVE_GUESTS', guestIds: [g.id] }] })).body.proposal;
    expect((await inbox(co.client)).notifications[0]).toMatchObject({ kind: 'proposal.created', title: 'Approval needed: Remove Anil', url: expect.stringContaining(`#proposal-${p.id}`) });
  });

  it('marks some or all as read, only for the signed-in user', async () => {
    const { owner, co, api } = await setup();
    await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co' } });
    await owner.client.post(api('/guests'), { guest: { name: 'B', email: 'b@x.co' } });
    const before = await inbox(co.client);
    const unread = before.unreadCount;

    // Another user can't mark Rohan's notifications.
    await owner.client.post('/api/v1/me/notifications/read', { ids: [before.notifications[0].id] });
    expect((await inbox(co.client)).unreadCount).toBe(unread);

    await co.client.post('/api/v1/me/notifications/read', { ids: [before.notifications[0].id] });
    expect((await inbox(co.client)).unreadCount).toBe(unread - 1);

    await co.client.post('/api/v1/me/notifications/read', { all: true });
    const after = await inbox(co.client);
    expect(after.unreadCount).toBe(0);
    expect(after.notifications.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it('pages through older notifications', async () => {
    const { owner, co, api } = await setup();
    for (let i = 0; i < 5; i++) await owner.client.post(api('/guests'), { guest: { name: `G${i}`, email: `g${i}@x.co` } });
    const first = (await co.client.get('/api/v1/me/notifications?limit=2')).body;
    expect(first.notifications).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = (await co.client.get(`/api/v1/me/notifications?limit=2&before=${first.nextCursor}`)).body;
    expect(second.notifications).toHaveLength(2);
    expect(second.notifications[0].id).not.toBe(first.notifications[0].id);
  });

  it('requires sign-in', async () => {
    const { owner } = await setup();
    const res = await owner.client.post('/api/v1/auth/logout');
    expect(res.status).toBe(204);
    expect((await owner.client.get('/api/v1/me/notifications')).status).toBe(401);
  });
});

describe('"needs your attention" (action items)', () => {
  it('lists pending publication approvals and proposals, and clears them once acted on', async () => {
    const { owner, co, eventId, api, version } = await setup();
    await owner.client.post(api('/publication/submit'), { expectedVersion: await version() });

    let items = (await co.client.get('/api/v1/me/action-items')).body.items;
    expect(items).toEqual([expect.objectContaining({ kind: 'PUBLICATION_APPROVAL', eventId, eventName: 'Wedding', url: `/events/${eventId}` })]);
    expect((await owner.client.get('/api/v1/me/action-items')).body.items).toEqual([]); // submitter already counts as approved

    await co.client.post(api('/publication/approve'), { expectedVersion: await version() });
    expect((await co.client.get('/api/v1/me/action-items')).body.items).toEqual([]);

    const g = (await owner.client.post(api('/guests'), { guest: { name: 'Anil', email: 'anil@x.co' } })).body.guest;
    const p = (await owner.client.post(api('/proposals'), { title: 'Remove Anil', description: 'x', changes: [{ type: 'REMOVE_GUESTS', guestIds: [g.id] }] })).body.proposal;
    items = (await co.client.get('/api/v1/me/action-items')).body.items;
    expect(items).toEqual([expect.objectContaining({ kind: 'PROPOSAL_DECISION', title: 'Approve proposal: Remove Anil', url: `/events/${eventId}?tab=proposals#proposal-${p.id}` })]);

    // Objecting still leaves it waiting on you; approving clears it.
    await co.client.post(api(`/proposals/${p.id}/object`), { expectedVersion: 1, comment: 'Hmm' });
    expect((await co.client.get('/api/v1/me/action-items')).body.items).toHaveLength(1);
    await co.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 });
    expect((await co.client.get('/api/v1/me/action-items')).body.items).toEqual([]);
  });

  it('nothing is waiting on anyone once the event is published', async () => {
    const { owner, co, api, version } = await setup();
    await owner.client.post(api('/publication/submit'), { expectedVersion: await version() });
    await co.client.post(api('/publication/approve'), { expectedVersion: await version() }).catch(() => undefined);
    // Event published (2 organisers) → nothing pending for anyone.
    expect((await owner.client.get('/api/v1/me/action-items')).body.items).toEqual([]);
    expect((await co.client.get('/api/v1/me/action-items')).body.items).toEqual([]);
  });
});
