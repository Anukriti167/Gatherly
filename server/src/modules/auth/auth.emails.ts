import { emailLayout, type MailMessage } from '../../lib/mailer.ts';

export function passwordResetEmail(to: string, name: string, url: string): MailMessage {
  const paragraphs = [
    `Hi ${name},`,
    'We received a request to reset your Gatherly password. This link expires in 1 hour and can be used once.',
    "If you didn't ask for this, you can safely ignore this email — your password won't change.",
  ];
  return {
    to,
    subject: 'Reset your Gatherly password',
    text: `${paragraphs.join('\n\n')}\n\nReset your password: ${url}\n`,
    html: emailLayout({ heading: 'Reset your password', paragraphs, action: { label: 'Reset password', url } }),
  };
}

export function verifyEmailEmail(to: string, name: string, url: string): MailMessage {
  const paragraphs = [
    `Hi ${name}, welcome to Gatherly!`,
    'Please confirm your email address. Verified emails let Gatherly show events you have been invited to on your dashboard.',
  ];
  return {
    to,
    subject: 'Confirm your email for Gatherly',
    text: `${paragraphs.join('\n\n')}\n\nConfirm your email: ${url}\n`,
    html: emailLayout({ heading: 'Confirm your email', paragraphs, action: { label: 'Confirm email', url } }),
  };
}

export function passwordChangedEmail(to: string, name: string): MailMessage {
  const paragraphs = [
    `Hi ${name},`,
    'Your Gatherly password was just changed and other signed-in devices were signed out.',
    "If this wasn't you, reset your password immediately using “Forgot password” on the sign-in page.",
  ];
  return {
    to,
    subject: 'Your Gatherly password was changed',
    text: paragraphs.join('\n\n'),
    html: emailLayout({ heading: 'Password changed', paragraphs }),
  };
}
