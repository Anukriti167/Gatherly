/**
 * Sends a test email through GoDaddy Node.js Hosting's built-in email gateway.
 *
 *   npm run mail:test -w server -- someone@example.com
 *
 * Run this on GoDaddy hosting, where the gateway is available at 127.0.0.1:2525.
 * The gateway does not expose a separate SMTP verify step; a successful send is the test.
 */
import { loadConfig, loadDotEnv } from '../src/config/env.ts';
import { emailLayout, GoDaddyMailer } from '../src/lib/mailer.ts';

loadDotEnv();
// This script doesn't touch the database; don't require DATABASE_URL to run it.
loadConfig({ DATABASE_URL: 'unused', ...process.env });

const to = process.argv[2];

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!to || !to.includes('@')) {
  fail('Usage: npm run mail:test -w server -- recipient@example.com');
}

console.log('Email gateway : http://127.0.0.1:2525/api/email/send');
console.log('From          : hello@letsgatherly.com');
console.log(`To            : ${to}\n`);

const mailer = new GoDaddyMailer();
const paragraphs = [
  'This is a test email from Gatherly.',
  'It was sent through GoDaddy Node.js Hosting’s built-in email gateway.',
];

try {
  process.stdout.write('Sending test email… ');
  await mailer.send({
    to,
    subject: 'Gatherly email test',
    text: paragraphs.join('\n\n'),
    html: emailLayout({ heading: 'Email is working', paragraphs }),
  });
  console.log('ok');
  console.log(`\n✓ Sent. Check the inbox (and spam folder) of ${to}.\n`);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  fail(`Email gateway send failed: ${message}`);
}
