import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env.ts';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('applies safe development defaults', () => {
    const c = loadConfig({ ...base });
    expect(c.env).toBe('development');
    expect(c.port).toBe(3000);
    expect(c.session.secureCookie).toBe(false);
    expect(c.session.cookieName).toBe('gatherly_sid');
    expect(c.mail.smtp).toBeUndefined();
  });

  it('uses a __Host- secure cookie when served over https', () => {
    const c = loadConfig({ ...base, APP_ORIGIN: 'https://gatherly.example' });
    expect(c.session.secureCookie).toBe(true);
    expect(c.session.cookieName).toBe('__Host-gatherly_sid');
  });

  it('refuses to start in production without https', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', APP_ORIGIN: 'http://gatherly.example' })).toThrow(/https/);
  });

  it('reports missing required variables clearly', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it('enables SMTP only when a host is provided', () => {
    const c = loadConfig({ ...base, SMTP_HOST: 'smtpout.secureserver.net', SMTP_USER: 'hello@x.com', SMTP_PASSWORD: 's' });
    expect(c.mail.smtp).toMatchObject({ host: 'smtpout.secureserver.net', port: 465, secure: true, user: 'hello@x.com' });
  });

  it('parses TRUST_PROXY as a hop count or boolean', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy).toBe(1);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    expect(loadConfig({ ...base }).trustProxy).toBe(false);
  });
});
