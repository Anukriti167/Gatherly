import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { guestImportTemplate } from '@gatherly/shared';
import { createTestContext, resetDatabase, signedInUser } from '../helpers.ts';

const { app, prisma, mailer } = createTestContext();
const event = { name: 'Wedding', eventType: 'WEDDING', timezone: 'Asia/Kolkata', startsAt: '2027-02-12T10:00', endsAt: '2027-02-14T23:00' };
const act = (name: string, day: string) => ({ name, timezone: 'Asia/Kolkata', startsAt: `2027-02-${day}T18:00`, endsAt: `2027-02-${day}T22:00` });

beforeEach(async () => {
  await resetDatabase(prisma);
  mailer.clear();
});
afterAll(() => prisma.$disconnect());

async function setup() {
  const owner = await signedInUser(app, 'Asha Owner');
  const eventId = (await owner.client.post('/api/v1/events', event)).body.event.id as string;
  const api = (p = '') => `/api/v1/events/${eventId}${p}`;
  const sangeet = (await owner.client.post(api('/activities'), { activity: act('Sangeet', '12') })).body.activity.id as string;
  const reception = (await owner.client.post(api('/activities'), { activity: act('Reception', '14') })).body.activity.id as string;
  return { owner, eventId, api, sangeet, reception };
}

/** Owner + an active co-admin. */
async function setupWithCoAdmin() {
  const s = await setup();
  const co = await signedInUser(app, 'Rohan CoAdmin');
  await s.owner.client.post(s.api('/members'), { email: co.email });
  await co.client.post(s.api('/members/me/accept'));
  mailer.clear();
  return { ...s, co };
}

async function publish(s: Awaited<ReturnType<typeof setupWithCoAdmin>>) {
  const v = async () => (await prisma.event.findUniqueOrThrow({ where: { id: s.eventId } })).version;
  await s.owner.client.post(s.api('/publication/submit'), { expectedVersion: await v() });
  await s.co.client.post(s.api('/publication/approve'), { expectedVersion: await v() });
  mailer.clear();
}

const version = async (eventId: string) => (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).version;

describe('adding guests manually (FR-068, FR-073, FR-076, FR-077)', () => {
  it('adds a guest with phone and specific activities; the event version is NOT bumped', async () => {
    const { owner, eventId, api, sangeet } = await setup();
    const v = await version(eventId);
    const res = await owner.client.post(api('/guests'), {
      guest: { name: 'Priya Mehta', email: 'Priya@Example.com', phone: '+91 98765 43210', activityIds: [sangeet] },
    });
    expect(res.status).toBe(201);
    expect(res.body.guest).toMatchObject({ name: 'Priya Mehta', email: 'priya@example.com', phone: '+91 98765 43210', allActivities: false, activityIds: [sangeet] });
    expect(await version(eventId)).toBe(v); // guest list isn't approved content
    expect(await prisma.auditLog.count({ where: { eventId, action: 'guest.added' } })).toBe(1);
  });

  it('"all activities" ignores explicit picks', async () => {
    const { owner, api, sangeet } = await setup();
    const res = await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co', allActivities: true, activityIds: [sangeet] } });
    expect(res.body.guest).toMatchObject({ allActivities: true, activityIds: [] });
  });

  it('blocks duplicate emails in the same event (FR-071) but allows them across events', async () => {
    const { owner, api } = await setup();
    await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'dup@x.co' } });
    const again = await owner.client.post(api('/guests'), { guest: { name: 'B', email: 'DUP@x.co' } });
    expect(again.status).toBe(409);
    expect(again.body.error.fields.email).toBeDefined();

    const other = await setup();
    expect((await other.owner.client.post(other.api('/guests'), { guest: { name: 'A', email: 'dup@x.co' } })).status).toBe(201);
  });

  it('validates name, email and phone (FR-070) and rejects activities from another event', async () => {
    const { owner, api } = await setup();
    const bad = await owner.client.post(api('/guests'), { guest: { name: '', email: 'nope', phone: 'call me' } });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.fields)).toEqual(expect.arrayContaining(['guest.name', 'guest.email', 'guest.phone']));

    const other = await setup();
    const foreign = await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co', activityIds: [other.sangeet] } });
    expect(foreign.status).toBe(400);
  });
});

describe('editing and removing (FR-075, FR-078, FR-079)', () => {
  it('updates contact details and re-assigns activities, auditing the change', async () => {
    const { owner, eventId, api, sangeet, reception } = await setup();
    const g = (await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co', activityIds: [sangeet] } })).body.guest;
    const res = await owner.client.patch(api(`/guests/${g.id}`), { changes: { phone: '+44 20 7946 0000', activityIds: [reception] } });
    expect(res.body.guest).toMatchObject({ phone: '+44 20 7946 0000', activityIds: [reception] });

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { eventId, action: 'guest.updated' } });
    expect(entry.before).toMatchObject({ phone: null, activityIds: [sangeet] });
    expect(entry.after).toMatchObject({ phone: '+44 20 7946 0000', activityIds: [reception] });
  });

  it('switching to "all activities" clears explicit assignments', async () => {
    const { owner, api, sangeet } = await setup();
    const g = (await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co', activityIds: [sangeet] } })).body.guest;
    const res = await owner.client.patch(api(`/guests/${g.id}`), { changes: { allActivities: true } });
    expect(res.body.guest).toMatchObject({ allActivities: true, activityIds: [] });
  });

  it('cannot change an email to one already on the list', async () => {
    const { owner, api } = await setup();
    await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co' } });
    const b = (await owner.client.post(api('/guests'), { guest: { name: 'B', email: 'b@x.co' } })).body.guest;
    expect((await owner.client.patch(api(`/guests/${b.id}`), { changes: { email: 'a@x.co' } })).status).toBe(409);
  });

  it('removing a guest (before publishing) hides them, frees the email, and keeps history', async () => {
    const { owner, eventId, api } = await setup();
    const g = (await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co' } })).body.guest;
    expect((await owner.client.delete(api(`/guests/${g.id}`))).status).toBe(204);
    expect((await owner.client.get(api('/guests'))).body.guests).toEqual([]);
    expect(await prisma.guest.count({ where: { eventId } })).toBe(1); // soft-deleted row kept
    expect((await owner.client.post(api('/guests'), { guest: { name: 'A again', email: 'a@x.co' } })).status).toBe(201);
  });

  it('removing an activity removes its assignments', async () => {
    const { owner, api, sangeet } = await setup();
    const g = (await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co', activityIds: [sangeet] } })).body.guest;
    await owner.client.delete(api(`/activities/${sangeet}`));
    const list = (await owner.client.get(api('/guests'))).body.guests;
    expect(list.find((x: { id: string }) => x.id === g.id).activityIds).toEqual([]);
  });
});

describe('rules before and after publishing (product decision 14 Nov 2026)', () => {
  it('guest changes while pending approval do NOT reset approvals', async () => {
    const s = await setupWithCoAdmin();
    await s.owner.client.post(s.api('/publication/submit'), { expectedVersion: await version(s.eventId) });
    const before = (await s.owner.client.get(s.api('/publication'))).body.publication.current.id;

    await s.co.client.post(s.api('/guests'), { guest: { name: 'A', email: 'a@x.co' } });

    const p = (await s.owner.client.get(s.api('/publication'))).body.publication;
    expect(p.current.id).toBe(before);
    expect(p.current.approvedCount).toBe(1);
  });

  it('after publishing, owner AND co-admins can still add and edit guests directly', async () => {
    const s = await setupWithCoAdmin();
    await publish(s);
    const v = await version(s.eventId);

    const added = await s.co.client.post(s.api('/guests'), { guest: { name: 'Late Guest', email: 'late@x.co', activityIds: [s.reception] } });
    expect(added.status).toBe(201);
    const edited = await s.owner.client.patch(s.api(`/guests/${added.body.guest.id}`), { changes: { allActivities: true } });
    expect(edited.status).toBe(200);
    const imported = await s.owner.client.post(s.api('/guests/import'), { csv: 'Name,Email\nZ,z@x.co', mode: 'commit' });
    expect(imported.body.report.imported).toBe(1);

    expect(await version(s.eventId)).toBe(v);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: s.eventId } })).status).toBe('PUBLISHED');
  });

  it('after publishing, removing a guest is blocked — it needs a change proposal', async () => {
    const s = await setupWithCoAdmin();
    const g = (await s.owner.client.post(s.api('/guests'), { guest: { name: 'A', email: 'a@x.co' } })).body.guest;
    await publish(s);

    const res = await s.owner.client.delete(s.api(`/guests/${g.id}`));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toMatch(/cuts off their access/);
    expect((await s.owner.client.get(s.api('/guests'))).body.guests).toHaveLength(1);

    const ev = (await s.owner.client.get(s.api())).body.event;
    expect(ev.allowedActions).toContain('guests.manage');
    expect(ev.allowedActions).not.toContain('guests.remove');
  });
});

describe('emails to the other organisers', () => {
  it('adding a guest emails the other organisers (not the person who did it) with the details', async () => {
    const s = await setupWithCoAdmin();
    await s.co.client.post(s.api('/guests'), { guest: { name: 'Priya Mehta', email: 'priya@x.co', activityIds: [s.sangeet] } });

    expect(mailer.lastTo(s.co.email)).toBeUndefined();
    const mail = mailer.lastTo(s.owner.email)!;
    expect(mail.subject).toBe('Guest list updated: “Wedding”');
    expect(mail.text).toContain('Rohan CoAdmin added a guest');
    expect(mail.text).toContain('• Priya Mehta (priya@x.co) — invited to Sangeet');
  });

  it('editing lists exactly what changed, before → after', async () => {
    const s = await setupWithCoAdmin();
    const g = (await s.owner.client.post(s.api('/guests'), { guest: { name: 'Priya', email: 'priya@x.co', activityIds: [s.sangeet] } })).body.guest;
    mailer.clear();

    await s.owner.client.patch(s.api(`/guests/${g.id}`), { changes: { phone: '+91 90000 00000', activityIds: [s.sangeet, s.reception] } });
    const text = mailer.lastTo(s.co.email)!.text;
    expect(text).toContain('Asha Owner updated Priya');
    expect(text).toContain('• Phone: — → +91 90000 00000');
    expect(text).toContain('• Now also invited to: Reception');
    expect(text).not.toContain('Name:');
  });

  it('taking an activity away stays direct (even after publishing) and is spelled out to the others', async () => {
    const s = await setupWithCoAdmin();
    const g = (await s.owner.client.post(s.api('/guests'), { guest: { name: 'Priya', email: 'priya@x.co', activityIds: [s.sangeet, s.reception] } })).body.guest;
    await publish(s);

    const res = await s.owner.client.patch(s.api(`/guests/${g.id}`), { changes: { activityIds: [s.reception] } });
    expect(res.status).toBe(200);
    expect(mailer.lastTo(s.co.email)!.text).toContain('• No longer invited to: Sangeet');
  });

  it('moving a guest off "all activities" says what they keep', async () => {
    const s = await setupWithCoAdmin();
    const g = (await s.owner.client.post(s.api('/guests'), { guest: { name: 'Priya', email: 'priya@x.co', allActivities: true } })).body.guest;
    mailer.clear();
    await s.owner.client.patch(s.api(`/guests/${g.id}`), { changes: { allActivities: false, activityIds: [s.sangeet] } });
    expect(mailer.lastTo(s.co.email)!.text).toContain('• No longer invited to all activities — now only: Sangeet');
  });

  it('an edit that changes nothing sends no email', async () => {
    const s = await setupWithCoAdmin();
    const g = (await s.owner.client.post(s.api('/guests'), { guest: { name: 'Priya', email: 'priya@x.co' } })).body.guest;
    mailer.clear();
    await s.owner.client.patch(s.api(`/guests/${g.id}`), { changes: { name: 'Priya' } });
    expect(mailer.sent).toHaveLength(0);
  });

  it('imports and removals are emailed too', async () => {
    const s = await setupWithCoAdmin();
    await s.owner.client.post(s.api('/guests/import'), { csv: 'Name,Email\nA,a@x.co\nB,b@x.co', mode: 'commit', allActivities: true });
    const importMail = mailer.lastTo(s.co.email)!.text;
    expect(importMail).toContain('imported 2 guests');
    expect(importMail).toContain('• A (a@x.co) — invited to all activities');

    const guests = (await s.owner.client.get(s.api('/guests'))).body.guests;
    await s.owner.client.delete(s.api(`/guests/${guests[0].id}`));
    expect(mailer.lastTo(s.co.email)!.text).toContain('removed a guest');
  });

  it('a preview never emails anyone', async () => {
    const s = await setupWithCoAdmin();
    await s.owner.client.post(s.api('/guests/import'), { csv: 'Name,Email\nA,a@x.co', mode: 'preview' });
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('CSV import (FR-069 – FR-071, FR-074)', () => {
  const csv = [
    'Full Name,E-mail,Mobile',
    'Rohan Mehta,rohan@example.com,+91 98765 43210',
    '"Rao, Priya",PRIYA@example.com,',
    'No Email,,',
    'Rohan Again,rohan@example.com,',
    'Existing Guest,existing@example.com,',
    'Bad Phone,bad@example.com,call me maybe',
  ].join('\n');

  it('previews every row with a status, without saving anything', async () => {
    const { owner, eventId, api } = await setup();
    await owner.client.post(api('/guests'), { guest: { name: 'Existing', email: 'existing@example.com' } });

    const res = await owner.client.post(api('/guests/import'), { csv, mode: 'preview' });
    expect(res.status).toBe(200);
    const { report } = res.body;
    expect(report.rows.map((r: { line: number; status: string }) => [r.line, r.status])).toEqual([
      [2, 'ok'],
      [3, 'ok'],
      [4, 'invalid'],
      [5, 'duplicate-in-file'],
      [6, 'already-on-list'],
      [7, 'invalid'],
    ]);
    expect(report.rows[1]).toMatchObject({ name: 'Rao, Priya', email: 'priya@example.com' });
    expect(report.counts).toEqual({ ok: 2, invalid: 2, 'duplicate-in-file': 1, 'already-on-list': 1 });
    expect(report.rows[5].errors[0]).toMatch(/^phone/);
    expect(await prisma.guest.count({ where: { eventId } })).toBe(1); // nothing saved
  });

  it('commits only valid rows, with the chosen activities', async () => {
    const { owner, eventId, api, reception } = await setup();
    const res = await owner.client.post(api('/guests/import'), { csv, mode: 'commit', activityIds: [reception] });

    expect(res.body.report).toMatchObject({ mode: 'commit', imported: 3 }); // Rohan, Priya, Existing (not on list here)
    const guests = (await owner.client.get(api('/guests'))).body.guests;
    expect(guests.map((g: { email: string }) => g.email).sort()).toEqual(['existing@example.com', 'priya@example.com', 'rohan@example.com']);
    expect(guests.every((g: { activityIds: string[] }) => g.activityIds.join() === reception)).toBe(true);
    expect(await prisma.auditLog.count({ where: { eventId, action: 'guests.imported' } })).toBe(1);
  });

  it('accepts the downloadable template exactly as downloaded (with Excel BOM and real activity names)', async () => {
    const { owner, api, sangeet, reception } = await setup();
    const template = guestImportTemplate(['Sangeet', 'Reception']);
    const res = await owner.client.post(api('/guests/import'), { csv: '﻿' + template, mode: 'preview' });
    expect(res.status).toBe(200);
    const { report } = res.body;
    expect(report.counts.ok).toBe(3);
    expect(report.columns.activities).toBe(3);
    expect(report.rows[0]).toMatchObject({ name: 'Asha Rao', phone: '+91 98765 43210', invitedTo: { all: true } });
    expect(report.rows[1].invitedTo).toEqual({ all: false, activityIds: [sangeet, reception], names: ['Sangeet', 'Reception'] });
    expect(report.rows[2].invitedTo).toBeNull(); // empty cell → default
    expect(report.rowsUsingDefault).toBe(1);
  });

  it('gives each row its own activities; empty cells use the chosen default', async () => {
    const { owner, api, sangeet, reception } = await setup();
    const csv = [
      'Name,Email,Activities',
      'All In,all@x.co,ALL',
      'Two Events,two@x.co,"  sangeet ;RECEPTION "',
      'Comma Separated,comma@x.co,"Sangeet, Reception"',
      'Just One,one@x.co,Reception',
      'Default Person,default@x.co,',
    ].join('\n');
    const res = await owner.client.post(api('/guests/import'), { csv, mode: 'commit', activityIds: [sangeet] });
    expect(res.body.report.imported).toBe(5);

    const byEmail = Object.fromEntries(
      (await owner.client.get(api('/guests'))).body.guests.map((g: { email: string; allActivities: boolean; activityIds: string[] }) => [
        g.email,
        g.allActivities ? 'ALL' : [...g.activityIds].sort().join('+'),
      ]),
    );
    const both = [sangeet, reception].sort().join('+');
    expect(byEmail).toEqual({
      'all@x.co': 'ALL',
      'two@x.co': both,
      'comma@x.co': both,
      'one@x.co': reception,
      'default@x.co': sangeet,
    });
  });

  it('flags unknown activity names with the list of real ones, and skips those rows', async () => {
    const { owner, api } = await setup();
    const csv = 'Name,Email,Activities\nTypo,typo@x.co,Sangeeth; Reception\nFine,fine@x.co,Reception';
    const preview = (await owner.client.post(api('/guests/import'), { csv, mode: 'preview' })).body.report;
    expect(preview.rows[0].status).toBe('invalid');
    expect(preview.rows[0].errors[0]).toBe('activities: Unknown activity “Sangeeth”. This event has: Sangeet, Reception');
    expect(preview.rows[1].status).toBe('ok');

    const commit = (await owner.client.post(api('/guests/import'), { csv, mode: 'commit' })).body.report;
    expect(commit.imported).toBe(1);
  });

  it('the import email lists each guest with their own activities', async () => {
    const s = await setupWithCoAdmin();
    await s.owner.client.post(s.api('/guests/import'), { csv: 'Name,Email,Activities\nA,a@x.co,Sangeet\nB,b@x.co,All', mode: 'commit' });
    const text = mailer.lastTo(s.co.email)!.text;
    expect(text).toContain('• A (a@x.co) — invited to Sangeet');
    expect(text).toContain('• B (b@x.co) — invited to all activities');
  });

  it('supports First name / Last name columns', async () => {
    const { owner, api } = await setup();
    const res = await owner.client.post(api('/guests/import'), { csv: 'First Name,Last Name,Email\nAsha,Rao,asha@x.co', mode: 'preview' });
    expect(res.body.report.rows[0]).toMatchObject({ name: 'Asha Rao', status: 'ok' });
  });

  it('explains missing headings', async () => {
    const { owner, api } = await setup();
    const res = await owner.client.post(api('/guests/import'), { csv: 'Rohan,rohan@x.co\nPriya,priya@x.co', mode: 'preview' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/headings/);
  });

  it('accepts files larger than the normal request limit (up to 1 MB)', async () => {
    const { owner, api } = await setup();
    const big = ['Name,Email', ...Array.from({ length: 2000 }, (_, i) => `Guest Number ${i},guest${i}@example-with-a-long-domain.com`)].join('\n');
    expect(big.length).toBeGreaterThan(100_000);
    const res = await owner.client.post(api('/guests/import'), { csv: big, mode: 'commit' });
    expect(res.status).toBe(200);
    expect(res.body.report.imported).toBe(2000);
  });
});

describe('access (FR-067, FR-082, FR-200)', () => {
  it('non-members cannot see the guest list or its contact details', async () => {
    const { owner, api } = await setup();
    await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co', phone: '+91 90000 00000' } });
    const stranger = await signedInUser(app);
    expect((await stranger.client.get(api('/guests'))).status).toBe(404);
    expect((await stranger.client.post(api('/guests'), { guest: { name: 'X', email: 'x@x.co' } })).status).toBe(404);
    expect((await stranger.client.post(api('/guests/import'), { csv: 'Name,Email\nX,x@x.co', mode: 'preview' })).status).toBe(404);
  });

  it('guests cannot be changed once the event is cancelled or completed', async () => {
    const { owner, eventId, api } = await setup();
    await prisma.event.update({ where: { id: eventId }, data: { status: 'COMPLETED' } });
    expect((await owner.client.post(api('/guests'), { guest: { name: 'A', email: 'a@x.co' } })).status).toBe(403);
  });
});
