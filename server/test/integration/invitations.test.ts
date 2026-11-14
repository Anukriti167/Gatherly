import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.ts';
import { hashToken } from '../../src/lib/crypto.ts';
import { OutboxService } from '../../src/modules/outbox/outbox.service.ts';
import { browser, createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer, config } = createTestContext();
const outbox = new OutboxService(prisma, mailer, createLogger(config), 20);

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

const event = { name: 'Asha & Rohan Wedding', eventType: 'WEDDING', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' };
const act = (name: string, day: string, extra = {}) => ({ name, timezone: 'Asia/Kolkata', startsAt: `2027-02-${day}T18:00`, endsAt: `2027-02-${day}T22:00`, ...extra });

/** Published event (sole owner) with two activities and guests Priya (Sangeet only) and Anil (all). */
async function setup(publish = true) {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  const sangeet = (
    await owner.client.post(api('/activities'), {
      activity: act('Sangeet', '12', { venueName: 'Taj Lands End', dressCode: 'Bright colours', instructions: 'Secret: hidden', showInstructions: false }),
    })
  ).body.activity.id as string;
  const reception = (await owner.client.post(api('/activities'), { activity: act('Reception', '14') })).body.activity.id as string;
  const priya = (await owner.client.post(api('/guests'), { guest: { name: 'Priya Shah', email: 'priya@x.co', phone: '+91 90000 00001', activityIds: [sangeet] } })).body.guest;
  const anil = (await owner.client.post(api('/guests'), { guest: { name: 'Anil Rao', email: 'anil@x.co', phone: '+91 90000 00002', allActivities: true } })).body.guest;
  if (publish) {
    const v = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;
    await owner.client.post(api('/publication/submit'), { expectedVersion: v });
  }
  mailer.clear();
  return { owner, eventId, api, sangeet, reception, priya, anil };
}

/** Sends queued mail and returns the invitation link token from the latest email to `to`. */
async function linkFor(to: string): Promise<string> {
  await outbox.processBatch();
  const mail = mailer.lastTo(to);
  const m = /\/i\/([A-Za-z0-9_-]+)/.exec(mail?.text ?? '');
  if (!m?.[1]) throw new Error(`no invitation link for ${to}`);
  return m[1];
}

/** A fresh browser that opens the invitation link → guest session. */
async function openLink(token: string) {
  const guest = browser(app);
  const res = await guest.post('/api/v1/guest/session', { token });
  return { guest, res };
}

describe('sending invitations (FR-083 – FR-086, FR-160, FR-226)', () => {
  it('is blocked until the event is published', async () => {
    const { owner, api } = await setup(false);
    expect((await owner.client.post(api('/invitations/send'), {})).status).toBe(403);
  });

  it('queues one email per guest, sent via the outbox, with the event, their own activities and a personal link', async () => {
    const { owner, api, priya, anil } = await setup();
    const res = await owner.client.post(api('/invitations/send'), {});
    expect(res.body).toEqual({ queued: 2 });

    let list = (await owner.client.get(api('/invitations'))).body.invitations;
    expect(list.find((i: { guestId: string }) => i.guestId === priya.id)).toMatchObject({ status: 'INVITED', delivery: 'QUEUED', sendCount: 1 });
    expect(mailer.sent).toHaveLength(0); // nothing sent until the worker runs

    await outbox.processBatch();
    const mail = mailer.lastTo('priya@x.co')!;
    expect(mail.subject).toBe("You're invited: Asha & Rohan Wedding");
    expect(mail.text).toContain('• Sangeet —');
    expect(mail.text).not.toContain('Reception'); // FR-085: only her activities
    expect(mail.text).toMatch(/\/i\/[A-Za-z0-9_-]{43}/);
    expect(mailer.lastTo('anil@x.co')!.text).toContain('• Reception —');

    list = (await owner.client.get(api('/invitations'))).body.invitations;
    expect(list.every((i: { delivery: string }) => i.delivery === 'SENT')).toBe(true);

    // Sending again without a selection only targets guests not yet invited.
    expect((await owner.client.post(api('/invitations/send'), {})).body).toEqual({ queued: 0 });
    void anil;
  });

  it('stores only a hash of the link token', async () => {
    const { owner, api, priya } = await setup();
    await owner.client.post(api('/invitations/send'), { guestIds: [priya.id] });
    const token = await linkFor('priya@x.co');
    const inv = await prisma.invitation.findUniqueOrThrow({ where: { guestId: priya.id } });
    expect(inv.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(inv)).not.toContain(token);
  });

  it('re-sending rotates the link: the old one stops working', async () => {
    const { owner, api, priya } = await setup();
    await owner.client.post(api('/invitations/send'), { guestIds: [priya.id] });
    const first = await linkFor('priya@x.co');
    await owner.client.post(api('/invitations/send'), { guestIds: [priya.id] });
    const second = await linkFor('priya@x.co');
    expect(second).not.toBe(first);
    expect((await openLink(first)).res.status).toBe(404);
    expect((await openLink(second)).res.status).toBe(204);
  });

  it('retries failed deliveries with back-off and shows the failure', async () => {
    const { owner, api, priya } = await setup();
    await owner.client.post(api('/invitations/send'), { guestIds: [priya.id] });
    const failing = new OutboxService(prisma, { send: async () => Promise.reject(new Error('SMTP down')) }, createLogger(config), 20);
    expect(await failing.processBatch()).toEqual({ sent: 0, failed: 1 });
    const job = await prisma.emailOutbox.findFirstOrThrow();
    expect(job).toMatchObject({ status: 'QUEUED', attempts: 1, lastError: 'SMTP down' });
    expect(job.nextAttemptAt.getTime()).toBeGreaterThan(Date.now()); // backed off

    // After 5 failures it's marked FAILED and organisers can retry.
    for (let i = 1; i <= 4; i++) await failing.processBatch(new Date(Date.now() + i * 10 * 3_600_000)); // each run after the back-off
    expect((await prisma.emailOutbox.findFirstOrThrow()).status).toBe('FAILED');
    const inv = (await owner.client.get(api('/invitations'))).body.invitations.find((i: { guestId: string }) => i.guestId === priya.id);
    expect(inv).toMatchObject({ delivery: 'FAILED', deliveryError: 'SMTP down' });

    expect((await owner.client.post(api(`/invitations/${priya.id}/retry`))).status).toBe(204);
    await outbox.processBatch();
    expect(mailer.lastTo('priya@x.co')).toBeDefined();
  });

  it('respects the per-minute sending limit', async () => {
    const { owner, api } = await setup();
    for (let i = 0; i < 5; i++) await owner.client.post(api('/guests'), { guest: { name: `G${i}`, email: `g${i}@x.co` } });
    await owner.client.post(api('/invitations/send'), {});
    const slow = new OutboxService(prisma, mailer, createLogger(config), 3);
    expect((await slow.processBatch()).sent).toBe(3);
    expect((await slow.processBatch()).sent).toBe(0); // budget used for this minute
  });
});

describe('guest access (FR-087 – FR-093, FR-096, FR-201)', () => {
  it('opens the personal event page with only the guest\'s activities and no one else\'s details', async () => {
    const { owner, api, priya, sangeet } = await setup();
    await owner.client.post(api('/invitations/send'), {});
    const { guest, res } = await openLink(await linkFor('priya@x.co'));
    expect(res.status).toBe(204);
    expect(res.headers['set-cookie']?.[0]).toMatch(/gatherly_guest=.*HttpOnly/i);

    const view = (await guest.get('/api/v1/guest/event')).body.view;
    expect(view).toMatchObject({ availability: 'AVAILABLE', guest: { name: 'Priya Shah' }, event: { name: 'Asha & Rohan Wedding', eventTypeLabel: 'Wedding' } });
    expect(view.activities.map((a: { id: string }) => a.id)).toEqual([sangeet]);
    expect(view.activities[0]).toMatchObject({ dressCode: 'Bright colours', instructions: null, rsvp: 'PENDING', rsvpOpen: true });
    expect(view.itinerary[0]).toMatchObject({ activityName: 'Sangeet' });

    const raw = JSON.stringify(view);
    for (const secret of ['anil@x.co', 'Anil Rao', '+91 90000 00002', '+91 90000 00001', 'priya@x.co', 'Secret: hidden']) {
      expect(raw).not.toContain(secret);
    }
    // Organiser endpoints stay closed to guests.
    expect((await guest.get(api('/guests'))).status).toBe(401);
    void priya;
  });

  it('rejects unknown links without revealing anything', async () => {
    const { res } = await openLink('x'.repeat(43));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('INVALID_INVITATION');
  });

  it('requires a guest session for the guest API', async () => {
    expect((await browser(app).get('/api/v1/guest/event')).status).toBe(401);
  });

  it('revoking an invitation ends access immediately, including open sessions (FR-090, FR-203)', async () => {
    const { owner, api, priya } = await setup();
    await owner.client.post(api('/invitations/send'), {});
    const token = await linkFor('priya@x.co');
    const { guest } = await openLink(token);
    expect((await guest.get('/api/v1/guest/event')).status).toBe(200);

    expect((await owner.client.post(api(`/invitations/${priya.id}/revoke`))).status).toBe(204);
    expect((await guest.get('/api/v1/guest/event')).status).toBe(401);
    expect((await openLink(token)).res.status).toBe(404);
    const list = (await owner.client.get(api('/invitations'))).body.invitations;
    expect(list.find((i: { guestId: string }) => i.guestId === priya.id).status).toBe('REVOKED');

    // Re-sending re-activates with a new link.
    await owner.client.post(api('/invitations/send'), { guestIds: [priya.id] });
    expect((await openLink(await linkFor('priya@x.co'))).res.status).toBe(204);
  });

  it('removing a guest (before publishing) ends their access too', async () => {
    const { owner, api, priya, eventId } = await setup(false);
    // Publish via a second event flow is not needed: insert an invitation directly for this check.
    const token = 'y'.repeat(43);
    await prisma.invitation.create({ data: { eventId, guestId: priya.id, tokenHash: hashToken(token), lastSentAt: new Date() } });
    const { guest } = await openLink(token);
    await owner.client.delete(api(`/guests/${priya.id}`));
    expect((await guest.get('/api/v1/guest/event')).status).toBe(401);
  });

  it('while unpublished, guests see only that the event is being updated', async () => {
    const { owner, api, eventId } = await setup();
    await owner.client.post(api('/invitations/send'), {});
    const { guest } = await openLink(await linkFor('anil@x.co'));
    await prisma.event.update({ where: { id: eventId }, data: { status: 'DRAFT' } });

    const view = (await guest.get('/api/v1/guest/event')).body.view;
    expect(view).toMatchObject({ availability: 'UPDATING', activities: [], itinerary: [] });
  });

  it('records when the guest opened the link', async () => {
    const { owner, api, anil } = await setup();
    await owner.client.post(api('/invitations/send'), {});
    await openLink(await linkFor('anil@x.co'));
    const inv = (await owner.client.get(api('/invitations'))).body.invitations.find((i: { guestId: string }) => i.guestId === anil.id);
    expect(inv.lastAccessedAt).not.toBeNull();
  });

  it('guest logout ends the session', async () => {
    const { owner, api } = await setup();
    await owner.client.post(api('/invitations/send'), {});
    const { guest } = await openLink(await linkFor('anil@x.co'));
    expect((await guest.post('/api/v1/guest/logout')).status).toBe(204);
    expect((await guest.get('/api/v1/guest/event')).status).toBe(401);
  });
});
