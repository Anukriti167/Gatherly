import { emailLayout, type MailMessage } from '../../lib/mailer.ts';

const MAX_LINES = 50;

/** Tells the other organisers exactly what changed on the guest list. */
export function guestListChangedEmail(o: {
  to: string;
  name: string;
  actorName: string;
  eventName: string;
  summary: string; // e.g. "added 3 guests"
  lines: string[];
  url: string;
}): MailMessage {
  const shown = o.lines.slice(0, MAX_LINES);
  const more = o.lines.length - shown.length;
  const list = more > 0 ? [...shown, `… and ${more} more`] : shown;
  const intro = [`Hi ${o.name},`, `${o.actorName} ${o.summary} on “${o.eventName}”:`];

  return {
    to: o.to,
    subject: `Guest list updated: “${o.eventName}”`,
    text: `${intro.join('\n\n')}\n\n${list.map((l) => `• ${l}`).join('\n')}\n\nView guest list: ${o.url}\n`,
    html: emailLayout({ heading: 'Guest list updated', paragraphs: intro, list, action: { label: 'View guest list', url: o.url } }),
  };
}
