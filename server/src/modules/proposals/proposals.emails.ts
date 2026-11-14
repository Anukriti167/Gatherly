import { emailLayout, type MailMessage } from '../../lib/mailer.ts';

/** One template for all proposal notifications (FR-150) — heading, short paragraphs, optional list. */
export function proposalEmail(o: {
  to: string;
  name: string;
  subject: string;
  heading: string;
  paragraphs: string[];
  list?: string[];
  url: string;
  actionLabel?: string;
}): MailMessage {
  const paragraphs = [`Hi ${o.name},`, ...o.paragraphs];
  const list = o.list ?? [];
  return {
    to: o.to,
    subject: o.subject,
    text: `${paragraphs.join('\n\n')}${list.length ? `\n\n${list.map((l) => `• ${l}`).join('\n')}` : ''}\n\n${o.actionLabel ?? 'Open proposal'}: ${o.url}\n`,
    html: emailLayout({ heading: o.heading, paragraphs, list, action: { label: o.actionLabel ?? 'Open proposal', url: o.url } }),
  };
}
