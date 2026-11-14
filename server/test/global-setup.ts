import { execSync } from 'node:child_process';
import pg from 'pg';
import { loadDotEnv } from '../src/config/env.ts';

/**
 * Prepares the test database before the suite runs:
 *  1. creates it if missing,
 *  2. applies migrations with the non-destructive `prisma migrate deploy`.
 * Tables are emptied between tests by `resetDatabase()` in helpers.ts.
 * Uses TEST_DATABASE_URL — never the development database.
 */
export default async function setup(): Promise<void> {
  loadDotEnv();
  const url = process.env['TEST_DATABASE_URL'];
  if (!url) throw new Error('TEST_DATABASE_URL is not set (see server/.env.example)');
  if (url === process.env['DATABASE_URL']) throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL — tests empty it');

  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  if (!/^[A-Za-z0-9_]+$/.test(dbName)) throw new Error(`Unsafe test database name: ${dbName}`);

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
