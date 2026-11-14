import { existsSync } from 'node:fs';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false', '1', '0', ''])
  .transform((v) => v === 'true' || v === '1');

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform((v): boolean | number => {
      if (v === 'true') return true;
      if (v === 'false' || v === '') return false;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 ? n : false;
    }),
  SMTP_HOST: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: booleanString.default(true),
  SMTP_USER: z.preprocess(emptyToUndefined, z.string().optional()),
  SMTP_PASSWORD: z.preprocess(emptyToUndefined, z.string().optional()),
  MAIL_FROM: z.string().default('Gatherly <no-reply@localhost>'),
  CONTACT_INBOX: z.preprocess(emptyToUndefined, z.email().optional()),
  RATE_LIMIT_ENABLED: booleanString.default(true),
  // Max emails sent per minute from the queue (protects the Titan mailbox from bulk invites).
  EMAIL_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(1000).default(20),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  CLIENT_DIST_DIR: z.preprocess(emptyToUndefined, z.string().optional()),
  // Uploaded photos (never served directly — always through an authorised route).
  STORAGE_DIR: z.preprocess(emptyToUndefined, z.string().default('storage')),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  env: Env['NODE_ENV'];
  isProduction: boolean;
  port: number;
  logLevel: Env['LOG_LEVEL'];
  appOrigin: string;
  databaseUrl: string;
  trustProxy: boolean | number;
  rateLimitEnabled: boolean;
  emailRatePerMinute: number;
  clientDistDir?: string;
  storageDir: string;
  session: {
    cookieName: string;
    secureCookie: boolean;
    ttlMs: number;
    /** Sliding expiry is refreshed at most this often to limit DB writes. */
    touchIntervalMs: number;
    guestCookieName: string;
    guestTtlMs: number;
  };
  mail: {
    from: string;
    contactInbox?: string;
    smtp?: { host: string; port: number; secure: boolean; user?: string; password?: string };
  };
  anthropicApiKey?: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** Parse and validate configuration. Throws with a readable message on invalid config. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isProduction = e.NODE_ENV === 'production';
  const secureCookie = e.APP_ORIGIN.startsWith('https://');

  if (isProduction && !secureCookie) {
    throw new Error('APP_ORIGIN must use https:// in production');
  }

  return {
    env: e.NODE_ENV,
    isProduction,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    appOrigin: e.APP_ORIGIN.replace(/\/$/, ''),
    databaseUrl: e.DATABASE_URL,
    trustProxy: e.TRUST_PROXY,
    rateLimitEnabled: e.RATE_LIMIT_ENABLED,
    emailRatePerMinute: e.EMAIL_RATE_PER_MINUTE,
    clientDistDir: e.CLIENT_DIST_DIR,
    storageDir: e.STORAGE_DIR,
    session: {
      // The __Host- prefix forces Secure, Path=/ and no Domain — only usable over HTTPS.
      cookieName: secureCookie ? '__Host-gatherly_sid' : 'gatherly_sid',
      secureCookie,
      ttlMs: 14 * DAY,
      touchIntervalMs: DAY,
      // Guests (invitation links) get their own cookie, separate from organiser sign-in.
      guestCookieName: secureCookie ? '__Host-gatherly_guest' : 'gatherly_guest',
      guestTtlMs: 90 * DAY,
    },
    mail: {
      from: e.MAIL_FROM,
      contactInbox: e.CONTACT_INBOX,
      smtp: e.SMTP_HOST
        ? { host: e.SMTP_HOST, port: e.SMTP_PORT, secure: e.SMTP_SECURE, user: e.SMTP_USER, password: e.SMTP_PASSWORD }
        : undefined,
    },
    anthropicApiKey: e.ANTHROPIC_API_KEY,
  };
}

/** Load server/.env (if present) without overriding variables already set by the host. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}
