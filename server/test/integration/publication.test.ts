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

type Client = Awaited<ReturnType<typeof signedInUser>>['client'];

/** Owner + optional active co-admins, an event with one activity (→ version 2). */
async function setup(coAdminNames: string[] = []) {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  await owner.client.post(api('/activities'), { activity });
  const coAdmins = [];
  for (const name of coAdminNames) {
    const u = await signedInUser(app, name);
    await owner.client.post(api('/members'), { email: u.email });
    await u.client.post(api('/members/me/accept'));
    coAdmins.push(u);
  }
  mailer.clear();
  return { owner, coAdmins, eventId, api };
}

const version = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;
const status = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status;
const pub = (c: Client, url: string) => c.get(url).then((r) => r.body.publication);

describe('submitting for publication (FR-223, FR-224)', () => {
  it('a sole owner publishes immediately — their submission is the unanimous approval', async () => {
    const { owner, eventId, api } = await setup();
    const res = await owner.client.post(api('/publication/submit'), { expectedVersion: await version(eventId) });

    expect(res.status).toBe(200);
    expect(res.body.publication.eventStatus).toBe('PUBLISHED');
    expect(res.body.publication.current).toMatchObject({ status: 'APPROVED', approvedCount: 1, requiredCount: 1 });
    expect(await status(eventId)).toBe('PUBLISHED');
    expect(mailer.lastTo(owner.email)?.subject).toMatch(/^Published/);
  });

  it('with co-admins it goes to Pending Approval; submitter counts as approved; others are emailed', async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan', 'Priya']);
    const res = await owner.client.post(api('/publication/submit'), { expectedVersion: await version(eventId) });

    const p = res.body.publication;
    expect(p.eventStatus).toBe('PENDING_APPROVAL');
    expect(p.current).toMatchObject({ status: 'OPEN', approvedCount: 1, requiredCount: 3, initiatedByName: 'Asha Owner' });
    expect(p.youCanApprove).toBe(false);
    for (const c of coAdmins) expect(mailer.lastTo(c.email)?.subject).toBe('Approval needed: “Wedding”');
    expect(mailer.lastTo(owner.email)).toBeUndefined();

    expect((await pub(coAdmins[0]!.client, api('/publication'))).youCanApprove).toBe(true);
  });

  it('requires at least one activity', async () => {
    const owner = await signedInUser(app);
    const id = (await owner.client.post('/api/v1/events', event)).body.event.id;
    const res = await owner.client.post(`/api/v1/events/${id}/publication/submit`, { expectedVersion: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/at least one activity/);
  });

  it('rejects submitting a stale version or an event that is not a draft', async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan']);
    expect((await owner.client.post(api('/publication/submit'), { expectedVersion: 1 })).status).toBe(409);
    await owner.client.post(api('/publication/submit'), { expectedVersion: await version(eventId) });
    expect((await coAdmins[0]!.client.post(api('/publication/submit'), { expectedVersion: await version(eventId) })).status).toBe(403);
  });
});

describe('approving (FR-222, FR-225, FR-226, FR-229, FR-230)', () => {
  it('publishes only when every approver has approved the same version', async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan', 'Priya']);
    const v = await version(eventId);
    await owner.client.post(api('/publication/submit'), { expectedVersion: v });

    const first = await coAdmins[0]!.client.post(api('/publication/approve'), { expectedVersion: v, comment: 'Looks great' });
    expect(first.body.publication).toMatchObject({ eventStatus: 'PENDING_APPROVAL', current: { approvedCount: 2 } });

    const last = await coAdmins[1]!.client.post(api('/publication/approve'), { expectedVersion: v });
    expect(last.body.publication.eventStatus).toBe('PUBLISHED');
    expect(last.body.publication.current.status).toBe('APPROVED');

    // FR-229: decisions recorded with approver, version and comment
    const decisions = await prisma.approvalDecision.findMany({ orderBy: { createdAt: 'asc' } });
    expect(decisions.map((d) => [d.decision, d.eventVersion])).toEqual([
      ['APPROVE', v],
      ['APPROVE', v],
      ['APPROVE', v],
    ]);
    expect(decisions[1]!.comment).toBe('Looks great');
    // FR-230: every organiser told it's published
    for (const u of [owner, ...coAdmins]) expect(mailer.lastTo(u.email)?.subject).toBe('Published: “Wedding”');
    expect(await prisma.auditLog.count({ where: { eventId, action: 'event.published' } })).toBe(1);
  });

  it("can't approve twice, can't approve an old version, and non-approvers can't decide", async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan', 'Priya']);
    const v = await version(eventId);
    await owner.client.post(api('/publication/submit'), { expectedVersion: v });

    expect((await owner.client.post(api('/publication/approve'), { expectedVersion: v })).status).toBe(409); // already approved
    expect((await coAdmins[0]!.client.post(api('/publication/approve'), { expectedVersion: v - 1 })).status).toBe(409);

    const stranger = await signedInUser(app);
    expect((await stranger.client.post(api('/publication/approve'), { expectedVersion: v })).status).toBe(404);
  });

  it('an organiser who joins mid-round is not required and cannot block it (FR-224 snapshot)', async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan']);
    const v = await version(eventId);
    await owner.client.post(api('/publication/submit'), { expectedVersion: v });

    const late = await signedInUser(app, 'Late Larry');
    await owner.client.post(api('/members'), { email: late.email });
    await late.client.post(api('/members/me/accept'));
    expect((await late.client.post(api('/publication/approve'), { expectedVersion: v })).status).toBe(403);

    const done = await coAdmins[0]!.client.post(api('/publication/approve'), { expectedVersion: v });
    expect(done.body.publication.eventStatus).toBe('PUBLISHED');
  });
});

describe('requesting changes and editing while pending (FR-227, FR-228)', () => {
  it('request changes sends the event back to Draft with the comment, and notifies others', async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan']);
    const v = await version(eventId);
    await owner.client.post(api('/publication/submit'), { expectedVersion: v });

    const noComment = await coAdmins[0]!.client.post(api('/publication/request-changes'), { expectedVersion: v, comment: ' ' });
    expect(noComment.status).toBe(400);

    const res = await coAdmins[0]!.client.post(api('/publication/request-changes'), { expectedVersion: v, comment: 'Add the haldi please' });
    expect(res.body.publication.eventStatus).toBe('DRAFT');
    expect(res.body.publication.current).toMatchObject({ status: 'CHANGES_REQUESTED' });
    expect(res.body.publication.current.approvers.find((a: { name: string }) => a.name === 'Rohan')).toMatchObject({
      state: 'CHANGES_REQUESTED',
      comment: 'Add the haldi please',
    });
    expect(mailer.lastTo(owner.email)?.text).toContain('Add the haldi please');

    // Back in draft → editable and can be resubmitted as a new round.
    expect((await owner.client.patch(api(), { changes: { description: 'Now with haldi' } })).status).toBe(200);
    const again = await owner.client.post(api('/publication/submit'), { expectedVersion: await version(eventId) });
    expect(again.body.publication.current.status).toBe('OPEN');
    expect(again.body.publication.history).toHaveLength(1);
  });

  it('any edit while pending invalidates approvals and starts a new round for the new version', async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan', 'Priya']);
    const v = await version(eventId);
    await owner.client.post(api('/publication/submit'), { expectedVersion: v });
    await coAdmins[0]!.client.post(api('/publication/approve'), { expectedVersion: v }); // 2/3

    // Priya edits an activity while pending.
    const acts = (await coAdmins[1]!.client.get(api('/activities'))).body.activities;
    await coAdmins[1]!.client.patch(api(`/activities/${acts[0].id}`), { changes: { dressCode: 'Pastels' } });

    const p = await pub(owner.client, api('/publication'));
    expect(p.eventStatus).toBe('PENDING_APPROVAL');
    expect(p.current).toMatchObject({ status: 'OPEN', eventVersion: v + 1, approvedCount: 1 }); // only the editor
    expect(p.current.reason).toMatch(/edited/);
    expect(p.history[0]).toMatchObject({ status: 'SUPERSEDED', eventVersion: v });
    expect(p.youCanApprove).toBe(true); // owner must re-approve the new version

    // Old approvals don't carry over: Rohan must approve again.
    await owner.client.post(api('/publication/approve'), { expectedVersion: v + 1 });
    expect(await status(eventId)).toBe('PENDING_APPROVAL');
    await coAdmins[0]!.client.post(api('/publication/approve'), { expectedVersion: v + 1 });
    expect(await status(eventId)).toBe('PUBLISHED');
  });

  it('removing a required approver restarts the round so it cannot stall', async () => {
    const { owner, coAdmins, eventId, api } = await setup(['Rohan']);
    const v = await version(eventId);
    await owner.client.post(api('/publication/submit'), { expectedVersion: v });

    const rohan = (await owner.client.get(api('/members'))).body.members.find((m: { name: string }) => m.name === 'Rohan');
    await owner.client.delete(api(`/members/${rohan.id}`));

    // Owner is now the only organiser and opened the new round → published.
    expect(await status(eventId)).toBe('PUBLISHED');
    expect((await coAdmins[0]!.client.get(api('/publication'))).status).toBe(404);
  });
});

describe('after publication', () => {
  it('direct edits are blocked and invitations become allowed (FR-226)', async () => {
    const { owner, eventId, api } = await setup();
    await owner.client.post(api('/publication/submit'), { expectedVersion: await version(eventId) });
    const ev = (await owner.client.get(api())).body.event;
    expect(ev.allowedActions).toContain('invitations.send');
    expect(ev.allowedActions).not.toContain('event.edit');
    expect((await owner.client.patch(api(), { changes: { name: 'X' } })).status).toBe(403);
  });
});
