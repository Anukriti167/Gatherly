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

/** Published event with owner + co-admins and two guests. */
async function publishedEvent(coAdminNames = ['Rohan', 'Priya']) {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  await owner.client.post(api('/activities'), { activity });
  const co = [];
  for (const name of coAdminNames) {
    const u = await signedInUser(app, name);
    await owner.client.post(api('/members'), { email: u.email });
    await u.client.post(api('/members/me/accept'));
    co.push(u);
  }
  const g1 = (await owner.client.post(api('/guests'), { guest: { name: 'Anil Shah', email: 'anil@x.co', allActivities: true } })).body.guest;
  const g2 = (await owner.client.post(api('/guests'), { guest: { name: 'Meera Iyer', email: 'meera@x.co', allActivities: true } })).body.guest;

  const v = async () => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;
  await owner.client.post(api('/publication/submit'), { expectedVersion: await v() });
  for (const u of co) await u.client.post(api('/publication/approve'), { expectedVersion: await v() });
  expect((await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status).toBe('PUBLISHED');
  mailer.clear();
  return { owner, co, eventId, api, g1, g2 };
}

const removeGuests = (ids: string[]) => ({ title: 'Remove guests', description: 'They told us they cannot come', changes: [{ type: 'REMOVE_GUESTS', guestIds: ids }] });
const activeGuests = async (eventId: string) => prisma.guest.count({ where: { eventId, removedAt: null } });
const status = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).status;

describe('creating proposals (FR-132 – FR-137)', () => {
  it('records approvers, counts the proposer as approved, and emails the others', async () => {
    const { owner, co, api, g1 } = await publishedEvent();
    const res = await owner.client.post(api('/proposals'), removeGuests([g1.id]));

    expect(res.status).toBe(201);
    const p = res.body.proposal;
    expect(p).toMatchObject({ status: 'OPEN', version: 1, approvedCount: 1, requiredCount: 3, youAreProposer: true, youCanDecide: false });
    expect(p.changes).toEqual([{ type: 'REMOVE_GUESTS', guests: [{ id: g1.id, name: 'Anil Shah', email: 'anil@x.co', stillOnList: true }] }]);

    for (const u of co) {
      const mail = mailer.lastTo(u.email)!;
      expect(mail.subject).toBe('Approval needed: “Remove guests” · Wedding');
      expect(mail.text).toContain('• Remove guests: Anil Shah (anil@x.co)');
      expect(mail.text).toContain('Reason: They told us they cannot come');
    }
    expect(mailer.lastTo(owner.email)).toBeUndefined();
  });

  it('only works on published events', async () => {
    const owner = await signedInUser(app);
    const id = (await owner.client.post('/api/v1/events', event)).body.event.id;
    const res = await owner.client.post(`/api/v1/events/${id}/proposals`, { title: 'x', description: 'y', changes: [{ type: 'UNPUBLISH' }] });
    expect(res.status).toBe(403);
  });

  it('validates changes: guests must be on this event, unpublish and cancel cannot be combined', async () => {
    const { owner, api } = await publishedEvent();
    const other = await publishedEvent([]);
    expect((await owner.client.post(api('/proposals'), removeGuests([other.g1.id]))).status).toBe(400);
    const both = await owner.client.post(api('/proposals'), { title: 'x', description: 'y', changes: [{ type: 'UNPUBLISH' }, { type: 'CANCEL_EVENT' }] });
    expect(both.status).toBe(400);
  });

  it('a sole organiser\'s proposal is applied immediately', async () => {
    const { owner, eventId, api, g1 } = await publishedEvent([]);
    const res = await owner.client.post(api('/proposals'), removeGuests([g1.id]));
    expect(res.body.proposal.status).toBe('APPLIED');
    expect(await activeGuests(eventId)).toBe(1);
  });
});

describe('approving and applying (FR-138, FR-144, FR-145)', () => {
  it('removes the guests only when everyone approves the same version', async () => {
    const { owner, co, eventId, api, g1 } = await publishedEvent();
    const p = (await owner.client.post(api('/proposals'), removeGuests([g1.id]))).body.proposal;

    const first = await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 });
    expect(first.body.proposal).toMatchObject({ status: 'OPEN', approvedCount: 2 });
    expect(await activeGuests(eventId)).toBe(2);

    const last = await co[1]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1, comment: 'Agreed' });
    expect(last.body.proposal.status).toBe('APPLIED');
    expect(await activeGuests(eventId)).toBe(1);
    expect((await owner.client.get(api('/guests'))).body.guests.map((g: { name: string }) => g.name)).toEqual(['Meera Iyer']);

    for (const u of [owner, ...co]) expect(mailer.lastTo(u.email)!.subject).toBe('Approved and applied: “Remove guests” · Wedding');
    expect(await prisma.auditLog.count({ where: { eventId, action: 'guest.removed' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { eventId, action: 'proposal.applied' } })).toBe(1);
  });

  it("rejects double approval, stale versions, and people who aren't required approvers", async () => {
    const { owner, co, api, g1 } = await publishedEvent();
    const p = (await owner.client.post(api('/proposals'), removeGuests([g1.id]))).body.proposal;
    expect((await owner.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 })).status).toBe(409);
    expect((await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 2 })).status).toBe(409);

    const late = await signedInUser(app, 'Late');
    await owner.client.post(api('/members'), { email: late.email });
    await late.client.post(api('/members/me/accept'));
    expect((await late.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 })).status).toBe(403);
  });
});

describe('objections, discussion, revision and withdrawal (FR-139 – FR-149)', () => {
  it('an objection keeps the proposal open; a later approval by the same person can complete it', async () => {
    const { owner, co, eventId, api, g1 } = await publishedEvent(['Rohan']);
    const p = (await owner.client.post(api('/proposals'), removeGuests([g1.id]))).body.proposal;

    const obj = await co[0]!.client.post(api(`/proposals/${p.id}/object`), { expectedVersion: 1, comment: 'Anil is my uncle!' });
    expect(obj.body.proposal).toMatchObject({ status: 'OPEN', objectionCount: 1 });
    expect(mailer.lastTo(owner.email)!.text).toContain('Rohan objected to the proposal: “Anil is my uncle!”');
    expect((await co[0]!.client.post(api(`/proposals/${p.id}/object`), { expectedVersion: 1, comment: ' ' })).status).toBe(400);

    await owner.client.post(api(`/proposals/${p.id}/comments`), { body: 'He told me he can’t travel.' });
    const done = await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 });
    expect(done.body.proposal.status).toBe('APPLIED');
    expect(await activeGuests(eventId)).toBe(1);

    const kinds = done.body.proposal.timeline.map((t: { kind: string; decision?: string }) => t.decision ?? t.kind);
    expect(kinds).toEqual(['revision', 'APPROVE', 'OBJECT', 'comment', 'APPROVE', 'closed']);
  });

  it('revising creates a new version and resets everyone else\'s approval', async () => {
    const { owner, co, eventId, api, g1, g2 } = await publishedEvent();
    const p = (await owner.client.post(api('/proposals'), removeGuests([g1.id]))).body.proposal;
    await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 });

    const rev = await owner.client.post(api(`/proposals/${p.id}/revise`), {
      expectedVersion: 1,
      description: 'Meera also cancelled',
      changes: [{ type: 'REMOVE_GUESTS', guestIds: [g1.id, g2.id] }],
    });
    expect(rev.body.proposal).toMatchObject({ version: 2, approvedCount: 1, description: 'Meera also cancelled' });
    expect(rev.body.proposal.changes[0].guests).toHaveLength(2);
    expect(mailer.lastTo(co[0]!.email)!.text).toContain('Earlier approvals were reset');

    // Approvals of version 1 don't count; both co-admins must approve v2.
    expect((await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 })).status).toBe(409);
    await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 2 });
    await co[1]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 2 });
    expect(await activeGuests(eventId)).toBe(0);
  });

  it('only the proposer can revise or withdraw; withdrawal is recorded and changes nothing', async () => {
    const { owner, co, eventId, api, g1 } = await publishedEvent();
    const p = (await owner.client.post(api('/proposals'), removeGuests([g1.id]))).body.proposal;
    expect((await co[0]!.client.post(api(`/proposals/${p.id}/withdraw`))).status).toBe(403);
    expect((await co[0]!.client.post(api(`/proposals/${p.id}/revise`), { expectedVersion: 1, description: 'x', changes: [{ type: 'UNPUBLISH' }] })).status).toBe(403);

    const res = await owner.client.post(api(`/proposals/${p.id}/withdraw`));
    expect(res.body.proposal).toMatchObject({ status: 'WITHDRAWN', closedReason: 'Withdrawn by the proposer' });
    expect(await activeGuests(eventId)).toBe(2);
    expect((await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 })).status).toBe(400);
  });
});

describe('unpublish and cancel', () => {
  it('unpublishing returns the event to Draft and closes other open proposals', async () => {
    const { owner, co, eventId, api, g1 } = await publishedEvent(['Rohan']);
    const other = (await co[0]!.client.post(api('/proposals'), removeGuests([g1.id]))).body.proposal;
    const p = (await owner.client.post(api('/proposals'), { title: 'Unpublish', description: 'Venue changed, re-planning', changes: [{ type: 'UNPUBLISH' }] })).body.proposal;
    await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 });

    expect(await status(eventId)).toBe('DRAFT');
    const closed = (await owner.client.get(api(`/proposals/${other.id}`))).body.proposal;
    expect(closed).toMatchObject({ status: 'CLOSED', closedReason: 'The event was unpublished' });
    // Back in Draft: editable again, and publishing needs approval again.
    expect((await owner.client.patch(api(), { changes: { description: 'New plan' } })).status).toBe(200);
  });

  it('cancelling cancels the event and all its activities (FR-152)', async () => {
    const { owner, co, eventId, api } = await publishedEvent(['Rohan']);
    const p = (await owner.client.post(api('/proposals'), { title: 'Cancel', description: 'Family emergency', changes: [{ type: 'CANCEL_EVENT', reason: 'Family emergency' }] })).body.proposal;
    await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 });

    expect(await status(eventId)).toBe('CANCELLED');
    expect(await prisma.activity.count({ where: { eventId, status: 'CANCELLED' } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { eventId, action: 'event.cancelled' } })).toBe(1);
  });
});

describe('organiser changes while a proposal is open (FR-146)', () => {
  it('removing a required approver means their approval is no longer needed', async () => {
    const { owner, co, eventId, api, g1 } = await publishedEvent(['Rohan', 'Priya']);
    const p = (await owner.client.post(api('/proposals'), removeGuests([g1.id]))).body.proposal;
    await co[0]!.client.post(api(`/proposals/${p.id}/approve`), { expectedVersion: 1 }); // 2 of 3

    const priya = (await owner.client.get(api('/members'))).body.members.find((m: { name: string }) => m.name === 'Priya');
    await owner.client.delete(api(`/members/${priya.id}`));

    expect((await owner.client.get(api(`/proposals/${p.id}`))).body.proposal.status).toBe('APPLIED');
    expect(await activeGuests(eventId)).toBe(1);
  });

  it('non-members cannot see proposals', async () => {
    const { owner, api, g1 } = await publishedEvent(['Rohan']);
    await owner.client.post(api('/proposals'), removeGuests([g1.id]));
    const stranger = await signedInUser(app);
    expect((await stranger.client.get(api('/proposals'))).status).toBe(404);
  });
});
