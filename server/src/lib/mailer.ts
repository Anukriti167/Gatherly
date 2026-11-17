import type { AppConfig } from '../config/env.ts';
import type { Logger } from './logger.ts';
import { sendEmail } from './email-gateway.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/**
 * Sends transactional email through GoDaddy Node.js Hosting's built-in
 * email gateway. The gateway chooses the canonical sender, so this class
 * deliberately does not set a `from` address.
 */
export class GoDaddyMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    await sendEmail({
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
  }
}

/** Development fallback: prints emails (including links) to the log. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info(
      { to: message.to, subject: message.subject },
      `\n──── email (not sent: local development mode) ────\n${message.text}\n────────────────`,
    );
  }
}

/** Test double: keeps sent messages in memory for assertions. */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.sent.push(message);
  }

  lastTo(to: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to);
  }

  clear(): void {
    this.sent.length = 0;
  }
}

/**
 * Use GoDaddy's gateway in production (including GoDaddy Preview).
 * Keep local development on ConsoleMailer so local runs do not try to
 * contact the hosting-only loopback gateway.
 */
export function createMailer(config: AppConfig, logger: Logger): Mailer {
  if (config.isProduction) {
    return new GoDaddyMailer();
  }

  return new ConsoleMailer(logger);
}

/**
 * Fire-and-forget send: the request doesn't wait for email delivery and
 * failures are logged. (Replaced by the DB-backed outbox with retries
 * and delivery status later, FR-160.)
 */
export function sendInBackground(
  mailer: Mailer,
  logger: Logger,
  message: MailMessage,
): void {
  mailer.send(message).catch((err: unknown) => {
    const error = err instanceof Error ? err : undefined;

    logger.error(
      {
        to: message.to,
        subject: message.subject,
        errorName: error?.name ?? 'UnknownError',
        errorMessage: error?.message ?? String(err),
      },
      'mail.send_failed',
    );
  });
}

/** Escape user-supplied text before interpolating into HTML emails. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Minimal, accessible HTML layout shared by all transactional emails. */
export function emailLayout(opts: {
  heading: string;
  paragraphs: string[];
  list?: string[];
  action?: { label: string; url: string };
}): string {
  const list = opts.list?.length
    ? `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">${opts.list.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
    : '';

  const paras = opts.paragraphs
    .map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`)
    .join('') + list;

  const button = opts.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.action.url)}" style="background:#4f46e5;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">${escapeHtml(opts.action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#555">If the button doesn't work, copy this link into your browser:<br>${escapeHtml(opts.action.url)}</p>`
    : '';

  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f6f6f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<h1 style="font-size:22px;margin:0 0 20px">${escapeHtml(opts.heading)}</h1>${paras}${button}
<p style="margin:32px 0 0;font-size:12px;color:#888">Sent by Gatherly</p></div></body></html>`;
}
