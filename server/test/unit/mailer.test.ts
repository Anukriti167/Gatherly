import { describe, expect, it } from 'vitest';
import { escapeHtml, mailAddressOf, smtpConfigProblem } from '../../src/lib/mailer.ts';

const smtp = { host: 'smtp.titan.email', port: 465, secure: true, user: 'hello@gatherly.in', password: 'secret' };

describe('mailAddressOf', () => {
  it('extracts the address from a display-name form', () => {
    expect(mailAddressOf('Gatherly <Hello@Gatherly.in>')).toBe('hello@gatherly.in');
  });
  it('accepts a bare address', () => {
    expect(mailAddressOf(' hello@gatherly.in ')).toBe('hello@gatherly.in');
  });
});

describe('smtpConfigProblem (GoDaddy Titan rules)', () => {
  it('is fine when SMTP is not configured (console mode)', () => {
    expect(smtpConfigProblem({ from: 'x@y.z' })).toBeNull();
  });
  it('is fine when From matches the mailbox, ignoring case', () => {
    expect(smtpConfigProblem({ from: 'Gatherly <HELLO@gatherly.in>', smtp })).toBeNull();
  });
  it('flags a From address that differs from the mailbox', () => {
    expect(smtpConfigProblem({ from: 'Gatherly <noreply@gatherly.in>', smtp })).toMatch(/must match SMTP_USER/);
  });
  it('flags missing credentials', () => {
    expect(smtpConfigProblem({ from: 'hello@gatherly.in', smtp: { ...smtp, password: undefined } })).toMatch(/required/);
  });
});

describe('escapeHtml', () => {
  it('neutralises markup in user-supplied text', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
  });
});
