import { describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../src/lib/logger.ts';
import {
  ConsoleMailer,
  emailLayout,
  escapeHtml,
  GoDaddyMailer,
  MemoryMailer,
} from '../../src/lib/mailer.ts';

describe('escapeHtml', () => {
  it('neutralises markup in user-supplied text', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;',
    );
  });
});

describe('emailLayout', () => {
  it('escapes content and renders the optional action link', () => {
    const html = emailLayout({
      heading: '<Hello>',
      paragraphs: ['A & B'],
      list: ['<item>'],
      action: { label: 'Open event', url: 'https://example.com/?a=1&b=2' },
    });

    expect(html).toContain('&lt;Hello&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('&lt;item&gt;');
    expect(html).toContain('https://example.com/?a=1&amp;b=2');
  });

  it('renders without optional list and action', () => {
    const html = emailLayout({ heading: 'Hello', paragraphs: ['Welcome'] });
    expect(html).toContain('<h1');
    expect(html).toContain('Welcome');
  });
});

describe('MemoryMailer', () => {
  it('stores sent messages and finds the latest message for a recipient', async () => {
    const mailer = new MemoryMailer();
    await mailer.send({ to: 'a@example.com', subject: 'First', text: 'one', html: '<p>one</p>' });
    await mailer.send({ to: 'a@example.com', subject: 'Second', text: 'two', html: '<p>two</p>' });
    await mailer.send({ to: 'b@example.com', subject: 'Other', text: 'x', html: '<p>x</p>' });

    expect(mailer.sent).toHaveLength(3);
    expect(mailer.lastTo('a@example.com')?.subject).toBe('Second');
    expect(mailer.lastTo('missing@example.com')).toBeUndefined();
    mailer.clear();
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('ConsoleMailer', () => {
  it('logs the message in local development mode', async () => {
    const info = vi.fn();
    const logger = { info } as unknown as Logger;
    const mailer = new ConsoleMailer(logger);

    await mailer.send({
      to: 'a@example.com',
      subject: 'Test',
      text: 'Email body',
      html: '<p>Email body</p>',
    });

    expect(info).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      { to: 'a@example.com', subject: 'Test' },
      expect.stringContaining('Email body'),
    );
  });
});

describe('GoDaddyMailer', () => {
  it('sends through the built-in loopback email gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, messageId: 'gateway-message-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    try {
      const mailer = new GoDaddyMailer();
      await expect(
        mailer.send({
          to: 'guest@example.com',
          subject: 'Gatherly invitation',
          text: 'You are invited',
          html: '<p>You are invited</p>',
          replyTo: 'hello@letsgatherly.com',
        }),
      ).resolves.toBeUndefined();

      expect(fetchMock).toHaveBeenCalledOnce();
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:2525/api/email/send');
      expect(options.method).toBe('POST');
      const payload = JSON.parse(String(options.body));
      expect(payload).toMatchObject({
        to: ['guest@example.com'],
        subject: 'Gatherly invitation',
        text: 'You are invited',
        html: '<p>You are invited</p>',
        from: 'hello@letsgatherly.com',
        replyTo: 'hello@letsgatherly.com',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
