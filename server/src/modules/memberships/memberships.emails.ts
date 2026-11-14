import { emailLayout, type MailMessage } from '../../lib/mailer.ts';

export function coAdminInvitationEmail(opts: { to: string; inviteeName: string; inviterName: string; eventName: string; url: string }): MailMessage {
  const paragraphs = [
    `Hi ${opts.inviteeName},`,
    `${opts.inviterName} has invited you to help organise “${opts.eventName}” on Gatherly as a co-admin.`,
    'Co-admins can plan activities, manage guests and approve changes together with the owner. Open your dashboard to accept or decline.',
  ];
  return {
    to: opts.to,
    subject: `You're invited to co-organise “${opts.eventName}”`,
    text: `${paragraphs.join('\n\n')}\n\nRespond on your dashboard: ${opts.url}\n`,
    html: emailLayout({ heading: 'Co-organiser invitation', paragraphs, action: { label: 'View invitation', url: opts.url } }),
  };
}

export function coAdminRemovedEmail(opts: { to: string; name: string; eventName: string }): MailMessage {
  const paragraphs = [`Hi ${opts.name},`, `You are no longer a co-admin of “${opts.eventName}” on Gatherly.`];
  return {
    to: opts.to,
    subject: `Your co-admin access to “${opts.eventName}” has ended`,
    text: paragraphs.join('\n\n'),
    html: emailLayout({ heading: 'Co-admin access ended', paragraphs }),
  };
}
