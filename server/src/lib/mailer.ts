import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config/env.ts';
import type { Logger } from './logger.ts';

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

/** Sends through SMTP — in production, the Titan mailbox on our GoDaddy domain. */
export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;

  constructor(
    smtp: NonNullable<AppConfig['mail']['smtp']>,
    private readonly from: string,
  ) {
    this.transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }

  /** Connects and authenticates without sending anything. Throws with the SMTP error if it fails. */
  async verify(): Promise<void> {
    await this.transport.verify();
  }
}

/** Extracts the bare address from `Name <addr@x.com>` or `addr@x.com`, lower-cased. */
export function mailAddressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim().toLowerCase();
}

/**
 * Titan (GoDaddy) only relays mail whose From address is the authenticated mailbox.
 * Returns a human-readable problem, or null when the configuration is consistent.
 */
export function smtpConfigProblem(config: AppConfig['mail']): string | null {
  const smtp = config.smtp;
  if (!smtp) return null;
  if (!smtp.user || !smtp.password) return 'SMTP_USER and SMTP_PASSWORD are required when SMTP_HOST is set';
  if (mailAddressOf(config.from) !== smtp.user.trim().toLowerCase()) {
    return `MAIL_FROM (${mailAddressOf(config.from)}) must match SMTP_USER (${smtp.user}) — Titan rejects other senders`;
  }
  return null;
}

/** Development fallback: prints emails (including links) to the log instead of sending. */
export class ConsoleMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info({ to: message.to, subject: message.subject }, `\n──── email (not sent: SMTP not configured) ────\n${message.text}\n────────────────`);
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

export function createMailer(config: AppConfig, logger: Logger): Mailer {
  if (!config.mail.smtp) return new ConsoleMailer(logger);
  const problem = smtpConfigProblem(config.mail);
  if (problem) {
    // Fail fast in production; in development fall back to the console so work isn't blocked.
    if (config.isProduction) throw new Error(`Email configuration error: ${problem}`);
    logger.warn(`Email configuration problem — printing emails to the console instead: ${problem}`);
    return new ConsoleMailer(logger);
  }
  return new SmtpMailer(config.mail.smtp, config.mail.from);
}

/**
 * Fire-and-forget send: the request doesn't wait on SMTP and failures are logged.
 * (Replaced by the DB-backed outbox with retries and delivery status later, FR-160.)
 */
export function sendInBackground(mailer: Mailer, logger: Logger, message: MailMessage): void {
  mailer.send(message).catch((err: unknown) => logger.error({ err, subject: message.subject }, 'mail.send_failed'));
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
export function emailLayout(opts: { heading: string; paragraphs: string[]; list?: string[]; action?: { label: string; url: string } }): string {
  const list = opts.list?.length
    ? `<ul style="margin:0 0 16px;padding-left:20px;line-height:1.6">${opts.list.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
    : '';
  const paras = opts.paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`).join('') + list;
  const button = opts.action
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.action.url)}" style="background:#4f46e5;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">${escapeHtml(opts.action.label)}</a></p>
       <p style="margin:0 0 16px;font-size:13px;color:#555">If the button doesn't work, copy this link into your browser:<br>${escapeHtml(opts.action.url)}</p>`
    : '';
  return `<!doctype html><html lang="en"><body style="margin:0;padding:24px;background:#f6f6f9;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px">
<h1 style="font-size:22px;margin:0 0 20px">${escapeHtml(opts.heading)}</h1>${paras}${button}
<p style="margin:32px 0 0;font-size:12px;color:#888">Sent by Gatherly</p></div></body></html>`;
}
