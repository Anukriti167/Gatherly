import { execSync } from 'node:child_process';
import mariadb from 'mariadb';
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

  const conn = await mariadb.createConnection({
    host: target.hostname,
    port: Number(target.port || 3306),
    user: decodeURIComponent(target.username),
    password: decodeURIComponent(target.password),
    allowPublicKeyRetrieval: true,
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await conn.end();
  }

  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
  });
}
