import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/logger.ts';
import { OutboxService } from '../../src/modules/outbox/outbox.service.ts';
import { browser, createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer, config } = createTestContext();
const outbox = new OutboxService(prisma, mailer, createLogger(config), 20);

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});

afterAll(() => prisma.$disconnect());

const eventInput = {
  name: 'Asha & Rohan Wedding',
  eventType: 'WEDDING',
  timezone: 'Asia/Kolkata',
  startsAt: '2027-02-12T10:00',
  endsAt: '2027-02-14T23:00',
};

const activityInput = (name: string, day: string) => ({
  name,
  timezone: 'Asia/Kolkata',
  startsAt: `2027-02-${day}T18:00`,
  endsAt: `2027-02-${day}T22:00`,
  venueName: 'Taj Lands End',
});

async function setup() {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (await owner.client.post('/api/v1/events', eventInput)).body.event.id as string;
  const eventPath = `/api/v1/events/${eventId}`;

  const sangeet = (
    await owner.client.post(`${eventPath}/activities`, { activity: activityInput('Sangeet', '12') })
  ).body.activity.id as string;
  const reception = (
    await owner.client.post(`${eventPath}/activities`, { activity: activityInput('Reception', '14') })
  ).body.activity.id as string;

  const priya = (
    await owner.client.post(`${eventPath}/guests`, {
      guest: { name: 'Priya Shah', email: 'priya@x.co', activityIds: [sangeet] },
    })
  ).body.guest;

  const anil = (
    await owner.client.post(`${eventPath}/guests`, {
      guest: { name: 'Anil Rao', email: 'anil@x.co', allActivities: true },
    })
  ).body.guest;

  const version = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;
  await owner.client.post(`${eventPath}/publication/submit`, { expectedVersion: version });

  const eventRow = await prisma.event.findUniqueOrThrow({
    where: { id: eventId },
    select: { slug: true },
  });
  const sangeetRow = await prisma.activity.findUniqueOrThrow({
    where: { id: sangeet },
    select: { slug: true },
  });
  const receptionRow = await prisma.activity.findUniqueOrThrow({
    where: { id: reception },
    select: { slug: true },
  });

  if (!eventRow.slug || !sangeetRow.slug || !receptionRow.slug) {
    throw new Error('Expected event and activity slugs to be populated');
  }

  mailer.clear();
  return {
    owner,
    eventId,
    eventPath,
    eventSlug: eventRow.slug,
    sangeet,
    sangeetSlug: sangeetRow.slug,
    reception,
    receptionSlug: receptionRow.slug,
    priya,
    anil,
  };
}

async function invitationTokenFor(email: string): Promise<string> {
  const mail = mailer.lastTo(email);
  const token = /\/i\/([A-Za-z0-9_-]+)/.exec(mail?.text ?? '')?.[1];
  if (!token) throw new Error(`No invitation token found for ${email}`);
  return token;
}

async function sendInvitations(owner: Awaited<ReturnType<typeof signedInUser>>, eventPath: string) {
  const result = await owner.client.post(`${eventPath}/invitations/send`, {});
  expect(result.status).toBe(200);
  await outbox.processBatch();
}

async function openGuest(token: string) {
  const guest = browser(app);
  const response = await guest.post('/api/v1/guest/session', { token });
  expect(response.status).toBe(204);
  return guest;
}

describe('guest event microsite access', () => {
  it('requires a valid guest session for the event homepage', async () => {
    const { eventSlug } = await setup();
    const response = await browser(app).get(`/api/v1/guest/events/${eventSlug}`);
    expect(response.status).toBe(401);
  });

  it('shows the event homepage with only activities assigned to that guest', async () => {
    const { owner, eventPath, eventSlug, sangeet, reception, priya } = await setup();
    await sendInvitations(owner, eventPath);

    const guest = await openGuest(await invitationTokenFor('priya@x.co'));
    const response = await guest.get(`/api/v1/guest/events/${eventSlug}`);

    expect(response.status).toBe(200);
    expect(response.body.view.guest.name).toBe('Priya Shah');
    expect(response.body.view.event.name).toBe('Asha & Rohan Wedding');
    expect(response.body.view.activities.map((activity: { id: string }) => activity.id)).toEqual([sangeet]);
    expect(response.body.view.activities.map((activity: { id: string }) => activity.id)).not.toContain(reception);
    void priya;
  });

  it('allows a guest to open an assigned activity page', async () => {
    const { owner, eventPath, eventSlug, sangeet, sangeetSlug } = await setup();
    await sendInvitations(owner, eventPath);

    const guest = await openGuest(await invitationTokenFor('priya@x.co'));
    const response = await guest.get(`/api/v1/guest/events/${eventSlug}/activities/${sangeetSlug}`);

    expect(response.status).toBe(200);
    expect(response.body.activity).toMatchObject({ id: sangeet, name: 'Sangeet', slug: sangeetSlug });
    expect(response.body.view.guest.name).toBe('Priya Shah');
  });

  it('does not allow a guest to open an activity they are not assigned to', async () => {
    const { owner, eventPath, eventSlug, receptionSlug } = await setup();
    await sendInvitations(owner, eventPath);

    const guest = await openGuest(await invitationTokenFor('priya@x.co'));
    const response = await guest.get(`/api/v1/guest/events/${eventSlug}/activities/${receptionSlug}`);

    expect(response.status).toBe(404);
  });

  it('keeps assigned activity access after the guest declines the RSVP', async () => {
    const { owner, eventPath, eventSlug, sangeet, sangeetSlug } = await setup();
    await sendInvitations(owner, eventPath);

    const guest = await openGuest(await invitationTokenFor('priya@x.co'));
    const declined = await guest.put(`/api/v1/guest/rsvps/${sangeet}`, { status: 'DECLINED' });
    expect(declined.status).toBe(200);

    const response = await guest.get(`/api/v1/guest/events/${eventSlug}/activities/${sangeetSlug}`);
    expect(response.status).toBe(200);
    expect(response.body.activity.id).toBe(sangeet);
    expect(response.body.activity.rsvp).toBe('DECLINED');
  });

  it('blocks event and activity microsite access after the invitation is revoked', async () => {
    const { owner, eventPath, eventSlug, sangeetSlug, priya } = await setup();
    await sendInvitations(owner, eventPath);

    const guest = await openGuest(await invitationTokenFor('priya@x.co'));
    expect((await guest.get(`/api/v1/guest/events/${eventSlug}`)).status).toBe(200);

    const revoked = await owner.client.post(`${eventPath}/invitations/${priya.id}/revoke`);
    expect(revoked.status).toBe(204);

    expect((await guest.get(`/api/v1/guest/events/${eventSlug}`)).status).toBe(401);
    expect((await guest.get(`/api/v1/guest/events/${eventSlug}/activities/${sangeetSlug}`)).status).toBe(401);
  });
});
