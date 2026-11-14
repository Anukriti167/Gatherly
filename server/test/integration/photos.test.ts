import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GUEST_PHOTO_LIMIT } from '@gatherly/shared';
import { hashToken } from '../../src/lib/crypto.ts';
import { createLogger } from '../../src/lib/logger.ts';
import { OutboxService } from '../../src/modules/outbox/outbox.service.ts';
import { fakeJpeg, fakePng } from '../fixtures/images.ts';
import { browser, createTestContext, ORIGIN, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer, config } = createTestContext();
const outbox = new OutboxService(prisma, mailer, createLogger(config), 100);

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

type Client = ReturnType<typeof browser>;
let setupCount = 0;

/** Multipart upload of a display image + thumbnail. */
const upload = (c: Client, url: string, opts: { full?: Buffer; thumb?: Buffer; caption?: string; activityId?: string } = {}) => {
  let req = c.agent
    .post(url)
    .set('Origin', ORIGIN)
    .attach('full', opts.full ?? fakeJpeg(1600, 1200), 'photo.jpg')
    .attach('thumb', opts.thumb ?? fakeJpeg(480, 360), 'thumb.jpg');
  if (opts.caption) req = req.field('caption', opts.caption);
  if (opts.activityId) req = req.field('activityId', opts.activityId);
  return req;
};

/** Published event; guests Priya (Sangeet only) and Anil, each with a guest session. */
async function setup(opts: { guestUploads?: boolean } = {}) {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (await owner.client.post('/api/v1/events', { name: 'Asha Wedding', eventType: 'WEDDING', timezone: 'UTC', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' })).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  const sangeet = (await owner.client.post(api('/activities'), { activity: { name: 'Sangeet', timezone: 'UTC', startsAt: '2027-02-12T18:00', endsAt: '2027-02-12T22:00' } })).body.activity.id as string;
  const reception = (await owner.client.post(api('/activities'), { activity: { name: 'Reception', timezone: 'UTC', startsAt: '2027-02-14T18:00', endsAt: '2027-02-14T22:00' } })).body.activity.id as string;
  const priya = (await owner.client.post(api('/guests'), { guest: { name: 'Priya Shah', email: 'priya@x.co', activityIds: [sangeet] } })).body.guest;
  const anil = (await owner.client.post(api('/guests'), { guest: { name: 'Anil Rao', email: 'anil@x.co', allActivities: true } })).body.guest;
  await owner.client.post(api('/publication/submit'), { expectedVersion: (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version });
  if (opts.guestUploads) await owner.client.put(api('/photos/settings'), { guestUploadsEnabled: true });

  const sessionFor = async (guestId: string, token: string) => {
    await prisma.invitation.create({ data: { eventId, guestId, tokenHash: hashToken(token), lastSentAt: new Date() } });
    const c = browser(app);
    await c.post('/api/v1/guest/session', { token });
    return c;
  };
  setupCount += 1; // unique link tokens per setup (some tests create two events)
  const token = (prefix: string) => `${prefix}${setupCount}`.padEnd(43, 'x');
  return { owner, eventId, api, sangeet, reception, priya, anil, priyaC: await sessionFor(priya.id, token('p')), anilC: await sessionFor(anil.id, token('a')) };
}

describe('organiser uploads (FR-161 – FR-163, FR-166)', () => {
  it('publishes immediately, tagged to an activity, with caption and uploader', async () => {
    const { owner, api, sangeet } = await setup();
    const res = await upload(owner.client, api('/photos'), { caption: 'First dance', activityId: sangeet });
    expect(res.status).toBe(201);
    expect(res.body.photo).toMatchObject({ status: 'APPROVED', caption: 'First dance', activityName: 'Sangeet', uploaderName: 'Asha Owner', width: 1600, height: 1200 });
    expect(res.body.photo.thumbUrl).toMatch(/^\/api\/v1\/photos\/.+\/thumb$/);
  });

  it('stores files with location data removed', async () => {
    const { owner, api } = await setup();
    const { photo } = (await upload(owner.client, api('/photos'))).body;
    const file = await owner.client.get(photo.fullUrl);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(file.headers['cache-control']).toBe('private, max-age=3600');
    expect(Buffer.from(file.body).toString('latin1')).not.toContain('GPS');
  });

  it('rejects files that are not real images, whatever their name (FR-044, FR-175)', async () => {
    const { owner, api } = await setup();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const res = await upload(owner.client, api('/photos'), { full: svg });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/JPEG, PNG or WebP/);
    expect(await prisma.photo.count()).toBe(0);
  });

  it('rejects oversized images and activities from other events', async () => {
    const { owner, api } = await setup();
    expect((await upload(owner.client, api('/photos'), { full: fakeJpeg(5000, 4000) })).status).toBe(400);
    expect((await upload(owner.client, api('/photos'), { full: Buffer.concat([fakeJpeg(), Buffer.alloc(9 * 1024 * 1024)]) })).status).toBe(413);
    const other = await setup();
    expect((await upload(owner.client, api('/photos'), { activityId: other.sangeet })).status).toBe(400);
  });

  it('can delete a photo; its files are gone too (FR-167, FR-178)', async () => {
    const { owner, api, anilC } = await setup();
    const { photo } = (await upload(owner.client, api('/photos'))).body;
    expect((await owner.client.delete(api(`/photos/${photo.id}`))).status).toBe(204);
    expect((await owner.client.get(photo.thumbUrl)).status).toBe(404);
    expect((await anilC.get('/api/v1/guest/photos')).body.photos).toEqual([]);
  });
});

describe('guests browsing (FR-164, FR-165, FR-176, FR-177, FR-205, FR-217)', () => {
  it('see every approved photo of the event — including activities they are not invited to', async () => {
    const { owner, api, reception, priyaC } = await setup();
    await upload(owner.client, api('/photos'), { activityId: reception, caption: 'Cake cutting' });
    const g = (await priyaC.get('/api/v1/guest/photos')).body;
    expect(g.photos).toEqual([expect.objectContaining({ caption: 'Cake cutting', activityName: 'Reception', uploaderName: 'Asha Owner', mine: false })]);
    const file = await priyaC.get(g.photos[0].thumbUrl);
    expect(file.status).toBe(200);
  });

  it('can download the full photo as a file', async () => {
    const { owner, api, priyaC } = await setup();
    const { photo } = (await upload(owner.client, api('/photos'))).body;
    const res = await priyaC.get(photo.downloadUrl);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="asha-wedding-.+\.jpg"$/);
  });

  it('strangers, other events\' guests and signed-out visitors cannot load photo files', async () => {
    const { owner, api } = await setup();
    const { photo } = (await upload(owner.client, api('/photos'))).body;
    const other = await setup();
    expect((await browser(app).get(photo.fullUrl)).status).toBe(404);
    expect((await (await signedInUser(app)).client.get(photo.fullUrl)).status).toBe(404);
    expect((await other.anilC.get(photo.fullUrl)).status).toBe(404);
  });

  it('a revoked guest loses access to photos immediately', async () => {
    const { owner, api, priya, priyaC } = await setup();
    const { photo } = (await upload(owner.client, api('/photos'))).body;
    await owner.client.post(api(`/invitations/${priya.id}/revoke`));
    expect((await priyaC.get(photo.thumbUrl)).status).toBe(404);
    expect((await priyaC.get('/api/v1/guest/photos')).status).toBe(401);
  });
});

describe('guest uploads with approval (FR-168 – FR-174)', () => {
  it('are off until organisers turn them on', async () => {
    const { priyaC } = await setup();
    const res = await upload(priyaC, '/api/v1/guest/photos');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/not turned on/);
  });

  it('wait for approval, visible only to the uploader until then; other guests see a short name', async () => {
    const { owner, api, sangeet, priyaC, anilC } = await setup({ guestUploads: true });
    const res = await upload(priyaC, '/api/v1/guest/photos', { caption: 'Our table!', activityId: sangeet });
    expect(res.status).toBe(201);
    expect(res.body.photo).toMatchObject({ status: 'PENDING_APPROVAL', mine: true });

    expect((await anilC.get('/api/v1/guest/photos')).body.photos).toEqual([]); // FR-171
    expect((await anilC.get(res.body.photo.thumbUrl)).status).toBe(404);
    expect((await priyaC.get(res.body.photo.thumbUrl)).status).toBe(200); // own pending photo

    // Organisers see it waiting, and it's on their to-do list.
    const org = (await owner.client.get(api('/photos'))).body.photos;
    expect(org[0]).toMatchObject({ status: 'PENDING_APPROVAL', uploaderName: 'Priya Shah' });
    const items = (await owner.client.get('/api/v1/me/action-items')).body.items;
    expect(items).toEqual([expect.objectContaining({ kind: 'PHOTO_REVIEW', title: 'Review 1 guest photo' })]);

    // Approve → everyone sees it, the guest is emailed.
    expect((await owner.client.post(api('/photos/review'), { photoIds: [res.body.photo.id], decision: 'APPROVE' })).body).toEqual({ updated: 1 });
    const anilView = (await anilC.get('/api/v1/guest/photos')).body.photos;
    expect(anilView[0]).toMatchObject({ caption: 'Our table!', uploaderName: 'Priya S.', status: 'APPROVED' });
    await outbox.processBatch();
    expect(mailer.lastTo('priya@x.co')?.subject).toBe('Your photos are in the gallery · Asha Wedding');
    expect((await owner.client.get('/api/v1/me/action-items')).body.items).toEqual([]);
  });

  it('rejection keeps the photo out and tells the guest why', async () => {
    const { owner, api, priyaC } = await setup({ guestUploads: true });
    const { photo } = (await upload(priyaC, '/api/v1/guest/photos')).body;
    await owner.client.post(api('/photos/review'), { photoIds: [photo.id], decision: 'REJECT', reason: 'A bit blurry' });
    const mine = (await priyaC.get('/api/v1/guest/photos')).body.photos[0];
    expect(mine).toMatchObject({ status: 'REJECTED', rejectionReason: 'A bit blurry' });
    await outbox.processBatch();
    expect(mailer.lastTo('priya@x.co')?.text).toContain('Their note: “A bit blurry”');
  });

  it(`limits each guest to ${GUEST_PHOTO_LIMIT} photos; rejected ones don't count`, async () => {
    const { owner, api, priyaC } = await setup({ guestUploads: true });
    const first = (await upload(priyaC, '/api/v1/guest/photos')).body.photo;
    await owner.client.post(api('/photos/review'), { photoIds: [first.id], decision: 'REJECT' });
    for (let i = 0; i < GUEST_PHOTO_LIMIT; i++) expect((await upload(priyaC, '/api/v1/guest/photos', { thumb: fakePng(200, 150) })).status).toBe(201);
    const over = await upload(priyaC, '/api/v1/guest/photos');
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('PHOTO_LIMIT');
    expect((await priyaC.get('/api/v1/guest/photos')).body.remainingUploads).toBe(0);
  });

  it('guests can only tag their own activities and cannot approve anything (FR-174)', async () => {
    const { reception, priyaC, api } = await setup({ guestUploads: true });
    expect((await upload(priyaC, '/api/v1/guest/photos', { activityId: reception })).status).toBe(400);
    const { photo } = (await upload(priyaC, '/api/v1/guest/photos')).body;
    expect((await priyaC.post(api('/photos/review'), { photoIds: [photo.id], decision: 'APPROVE' })).status).toBe(401);
  });
});
