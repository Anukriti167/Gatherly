import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { browser, createTestContext, resetDatabase, signedInUser, tokenFromEmail } from '../helpers.ts';

const { app, prisma, mailer } = createTestContext();
const event = { name: 'Wedding', eventType: 'WEDDING', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' };
const activity = { name: 'Sangeet', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T19:00', endsAt: '2027-02-12T23:00' };

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

/** Organiser publishes an event and invites asha@example.com. */
async function invite(opts: { send?: boolean } = {}) {
  const owner = await signedInUser(app, 'Owner');
  const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  await owner.client.post(api('/activities'), { activity });
  const guest = (await owner.client.post(api('/guests'), { guest: { name: 'Asha Rao', email: 'asha@example.com', allActivities: true } })).body.guest;
  await owner.client.post(api('/publication/submit'), { expectedVersion: (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version });
  if (opts.send !== false) await owner.client.post(api('/invitations/send'), {});
  return { owner, eventId, api, guest };
}

/** Registers asha@example.com, optionally confirming the email via the emailed link. */
async function asha(verify: boolean) {
  const c = browser(app);
  await c.post('/api/v1/auth/register', { name: 'Asha Rao', email: 'Asha@Example.com', password: 'password-123' });
  if (verify) {
    const token = tokenFromEmail(mailer.lastTo('asha@example.com')!.text);
    await c.post('/api/v1/auth/verify-email', { token });
  }
  return c;
}

describe('events you are invited to on the dashboard (FR-006)', () => {
  it('appear once the account email is verified, labelled as a guest', async () => {
    const { eventId } = await invite();
    const c = await asha(true);
    const events = (await c.get('/api/v1/events')).body.events;
    expect(events).toEqual([expect.objectContaining({ id: eventId, name: 'Wedding', role: 'GUEST', timeframe: 'upcoming' })]);
  });

  it('do NOT appear for an unverified email — signing up with someone else\'s address reveals nothing', async () => {
    await invite();
    const c = await asha(false);
    expect((await c.get('/api/v1/events')).body.events).toEqual([]);
  });

  it('do not appear before the invitation is actually sent, or after it is revoked', async () => {
    const { owner, api, guest } = await invite({ send: false });
    const c = await asha(true);
    expect((await c.get('/api/v1/events')).body.events).toEqual([]);

    await owner.client.post(api('/invitations/send'), {});
    expect((await c.get('/api/v1/events')).body.events).toHaveLength(1);

    await owner.client.post(api(`/invitations/${guest.id}/revoke`));
    expect((await c.get('/api/v1/events')).body.events).toEqual([]);
  });

  it('a completed event only stays in history if the guest confirmed at least one activity (FR-180)', async () => {
    const { eventId, guest } = await invite();
    const c = await asha(true);
    await prisma.event.update({ where: { id: eventId }, data: { status: 'COMPLETED' } });
    expect((await c.get('/api/v1/events')).body.events).toEqual([]);

    const act = await prisma.activity.findFirstOrThrow({ where: { eventId } });
    await prisma.rsvp.create({ data: { guestId: guest.id, activityId: act.id, status: 'CONFIRMED', respondedAt: new Date() } });
    expect((await c.get('/api/v1/events')).body.events).toEqual([expect.objectContaining({ id: eventId, role: 'GUEST', timeframe: 'completed' })]);
  });

  it('organisers who are also on the guest list see the event once, as organiser', async () => {
    const owner = await signedInUser(app, 'Owner');
    const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
    await prisma.user.update({ where: { email: owner.email }, data: { emailVerifiedAt: new Date() } });
    await owner.client.post(`/api/v1/events/${eventId}/activities`, { activity });
    await owner.client.post(`/api/v1/events/${eventId}/guests`, { guest: { name: 'Me', email: owner.email } });
    await owner.client.post(`/api/v1/events/${eventId}/publication/submit`, { expectedVersion: (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version });
    await owner.client.post(`/api/v1/events/${eventId}/invitations/send`, {});
    const events = (await owner.client.get('/api/v1/events')).body.events;
    expect(events).toEqual([expect.objectContaining({ id: eventId, role: 'OWNER' })]);
  });
});

describe('opening the guest page from your account', () => {
  it('starts a guest session for your own invitation', async () => {
    const { eventId } = await invite();
    const c = await asha(true);
    expect((await c.post('/api/v1/guest/session/from-account', { eventId })).status).toBe(204);
    const view = (await c.get('/api/v1/guest/event')).body.view;
    expect(view).toMatchObject({ guest: { name: 'Asha Rao' }, event: { name: 'Wedding' } });
  });

  it('refuses unverified accounts, signed-out visitors, and events you are not invited to', async () => {
    const { eventId } = await invite();
    const unverified = await asha(false);
    const r1 = await unverified.post('/api/v1/guest/session/from-account', { eventId });
    expect(r1.status).toBe(403);
    expect(r1.body.error.code).toBe('EMAIL_NOT_VERIFIED');

    expect((await browser(app).post('/api/v1/guest/session/from-account', { eventId })).status).toBe(401);

    const other = await signedInUser(app, 'Someone Else');
    await prisma.user.update({ where: { email: other.email }, data: { emailVerifiedAt: new Date() } });
    expect((await other.client.post('/api/v1/guest/session/from-account', { eventId })).status).toBe(404);
  });
});
