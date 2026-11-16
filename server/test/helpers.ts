import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { createApp } from '../src/app.ts';
import { loadConfig, loadDotEnv } from '../src/config/env.ts';
import { createLogger } from '../src/lib/logger.ts';
import { MemoryMailer } from '../src/lib/mailer.ts';
import { createPrisma, type PrismaClient } from '../src/lib/prisma.ts';

export const ORIGIN = 'http://localhost:5173';

/** Builds a real app against the test database, with an in-memory mailer. */
export function createTestContext() {
  loadDotEnv();
  const config = loadConfig({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env['TEST_DATABASE_URL'],
    APP_ORIGIN: ORIGIN,
    RATE_LIMIT_ENABLED: 'false',
    // Photos from tests go to a throwaway folder, never the real storage directory.
    STORAGE_DIR: join(tmpdir(), 'gatherly-test-storage'),
    SMTP_HOST: '',
  });
  const prisma = createPrisma(config.databaseUrl);
  const mailer = new MemoryMailer();
  const app = createApp({ config, prisma, mailer, logger: createLogger(config) });
  return { config, prisma, mailer, app };
}

/** Empties every table (keeps the schema). One connection, so the FK-check switch applies to it. */
export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRawUnsafe<{ name: string }[]>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'",
    );
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0');
    for (const { name } of rows) await tx.$executeRawUnsafe('DELETE FROM `' + name + '`');
    await tx.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1');
  });
}

/** A cookie-keeping client that sends the Origin header like a browser on our site. */
export function browser(app: Parameters<typeof request.agent>[0]) {
  const agent = request.agent(app);
  return {
    agent,
    get: (url: string) => agent.get(url).set('Origin', ORIGIN),
    post: (url: string, body: object = {}) => agent.post(url).set('Origin', ORIGIN).send(body),
    patch: (url: string, body: object) => agent.patch(url).set('Origin', ORIGIN).send(body),
    put: (url: string, body: object) => agent.put(url).set('Origin', ORIGIN).send(body),
    delete: (url: string) => agent.delete(url).set('Origin', ORIGIN),
  };
}

/** Pulls the `token` query parameter out of the first link in an email body. */
export function tokenFromEmail(text: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error(`No token link found in email:\n${text}`);
  return decodeURIComponent(match[1]);
}

let counter = 0;
/** Registers a fresh user and returns a signed-in browser for them. */
export async function signedInUser(app: Parameters<typeof request.agent>[0], name = 'Test User') {
  counter += 1;
  const email = `user${counter}-${Date.now()}@example.com`;
  const client = browser(app);
  const res = await client.post('/api/v1/auth/register', { name, email, password: 'password-123' });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client, user: res.body.user as { id: string; email: string; name: string }, email, password: 'password-123' };
}
