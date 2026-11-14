/**
 * Checks the GoDaddy (Titan) SMTP configuration and sends a test email.
 *
 *   npm run mail:test -w server -- someone@example.com
 *
 * Reads settings from server/.env. Never prints the password.
 */
import { loadConfig, loadDotEnv } from '../src/config/env.ts';
import { emailLayout, SmtpMailer, smtpConfigProblem } from '../src/lib/mailer.ts';

loadDotEnv();
// This script doesn't touch the database; don't require DATABASE_URL to run it.
const config = loadConfig({ DATABASE_URL: 'unused', ...process.env });
const to = process.argv[2];

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!to || !to.includes('@')) fail('Usage: npm run mail:test -w server -- recipient@example.com');
const smtp = config.mail.smtp;
if (!smtp) fail('SMTP_HOST is empty in server/.env — set it to smtp.titan.email (or smtpout.secureserver.net).');

const problem = smtpConfigProblem(config.mail);
if (problem) fail(problem);

console.log(`SMTP host : ${smtp.host}:${smtp.port} (${smtp.secure ? 'TLS' : 'STARTTLS/plain'})`);
console.log(`Mailbox   : ${smtp.user}`);
console.log(`From      : ${config.mail.from}`);
console.log(`To        : ${to}\n`);

const mailer = new SmtpMailer(smtp, config.mail.from);

try {
  process.stdout.write('1/2 Connecting and signing in… ');
  await mailer.verify();
  console.log('ok');

  process.stdout.write('2/2 Sending test email… ');
  const paragraphs = [
    'This is a test email from Gatherly.',
    `It was sent through ${smtp.host} using the ${smtp.user} mailbox. If you can read this, email is configured correctly.`,
  ];
  await mailer.send({
    to,
    subject: 'Gatherly email test',
    text: paragraphs.join('\n\n'),
    html: emailLayout({ heading: 'Email is working', paragraphs }),
  });
  console.log('ok');
  console.log(`\n✓ Sent. Check the inbox (and spam folder) of ${to}.\n`);
} catch (err) {
  const e = err as { code?: string; responseCode?: number; message?: string };
  console.log('failed');
  const hints: string[] = [];
  if (e.code === 'EAUTH' || e.responseCode === 535) {
    hints.push('The mailbox rejected the username or password. Use the FULL email address as SMTP_USER.');
    if (smtp.host !== 'smtpout.secureserver.net') hints.push('GoDaddy tip: try SMTP_HOST=smtpout.secureserver.net instead.');
  } else if (e.code === 'ETIMEDOUT' || e.code === 'ECONNECTION' || e.code === 'ESOCKET') {
    hints.push('Could not reach the SMTP server. Check SMTP_HOST/SMTP_PORT and that port 465 is not blocked by your network.');
  } else if (e.code === 'EENVELOPE' || e.responseCode === 553 || e.responseCode === 550) {
    hints.push('The sender was rejected. MAIL_FROM must be the same mailbox as SMTP_USER.');
  }
  fail([`${e.code ?? 'ERROR'}: ${e.message ?? String(err)}`, ...hints].join('\n  '));
}
