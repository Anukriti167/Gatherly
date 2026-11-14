import { emailLayout, type MailMessage } from '../../lib/mailer.ts';

export function approvalRequestedEmail(o: { to: string; name: string; requesterName: string; eventName: string; url: string }): MailMessage {
  const paragraphs = [
    `Hi ${o.name},`,
    `${o.requesterName} has submitted “${o.eventName}” for publication. It goes live only when every organiser approves.`,
    'Please review the event and approve it, or request changes.',
  ];
  return {
    to: o.to,
    subject: `Approval needed: “${o.eventName}”`,
    text: `${paragraphs.join('\n\n')}\n\nReview: ${o.url}\n`,
    html: emailLayout({ heading: 'Your approval is needed', paragraphs, action: { label: 'Review event', url: o.url } }),
  };
}

export function eventPublishedEmail(o: { to: string; name: string; eventName: string; url: string }): MailMessage {
  const paragraphs = [`Hi ${o.name},`, `All organisers approved — “${o.eventName}” is now published. You can now invite guests.`];
  return {
    to: o.to,
    subject: `Published: “${o.eventName}”`,
    text: `${paragraphs.join('\n\n')}\n\nOpen event: ${o.url}\n`,
    html: emailLayout({ heading: 'Your event is published', paragraphs, action: { label: 'Open event', url: o.url } }),
  };
}

export function changesRequestedEmail(o: { to: string; name: string; requesterName: string; eventName: string; comment: string; url: string }): MailMessage {
  const paragraphs = [
    `Hi ${o.name},`,
    `${o.requesterName} requested changes to “${o.eventName}” before it can be published. It's back in Draft.`,
    `Their note: “${o.comment}”`,
  ];
  return {
    to: o.to,
    subject: `Changes requested: “${o.eventName}”`,
    text: `${paragraphs.join('\n\n')}\n\nOpen event: ${o.url}\n`,
    html: emailLayout({ heading: 'Changes requested', paragraphs, action: { label: 'Open event', url: o.url } }),
  };
}
