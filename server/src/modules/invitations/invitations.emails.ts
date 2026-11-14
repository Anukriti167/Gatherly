import { emailLayout, type MailMessage } from '../../lib/mailer.ts';

const fmt = (d: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(d);

/** FR-084, FR-085 — event name, details, the guest's own activities and their personal link. */
export function invitationEmail(o: {
  to: string;
  guestName: string;
  event: { name: string; description: string; startsAt: Date; endsAt: Date; timezone: string };
  activities: { name: string; startsAt: Date; timezone: string; venue: string | null }[];
  organiserName: string | null;
  url: string;
}): MailMessage {
  const when = `${fmt(o.event.startsAt, o.event.timezone)} – ${fmt(o.event.endsAt, o.event.timezone)}`;
  const intro = [
    `Hi ${o.guestName},`,
    `You're invited to “${o.event.name}”${o.organiserName ? ` by ${o.organiserName}` : ''}.`,
    `When: ${when}`,
    ...(o.event.description ? [o.event.description.slice(0, 500)] : []),
    o.activities.length ? "You're invited to:" : 'Open your personal event page for all the details.',
  ];
  const list = o.activities.map((a) => `${a.name} — ${fmt(a.startsAt, a.timezone)}${a.venue ? ` · ${a.venue}` : ''}`);
  const outro = 'This link is personal to you — please don’t forward it. You can RSVP, see the schedule and get directions there; no account needed.';

  return {
    to: o.to,
    subject: `You're invited: ${o.event.name}`,
    text: `${intro.join('\n\n')}\n${list.map((l) => `• ${l}`).join('\n')}\n\nOpen your invitation: ${o.url}\n\n${outro}\n`,
    html: emailLayout({ heading: o.event.name, paragraphs: intro, list, action: { label: 'Open my invitation', url: o.url } }).replace(
      'Sent by Gatherly',
      `${outro.replace('—', '&mdash;')}<br><br>Sent by Gatherly`,
    ),
  };
}
