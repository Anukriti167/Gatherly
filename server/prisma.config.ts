import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Load server/.env for local CLI commands.
// Existing environment variables take precedence.
if (existsSync('.env')) process.loadEnvFile('.env');

const databaseUrl =
  process.env['DATABASE_URL'] ??
  (process.env['DB_HOST'] &&
  process.env['DB_NAME'] &&
  process.env['DB_USER']
    ? `mysql://${encodeURIComponent(process.env['DB_USER'])}:${encodeURIComponent(process.env['DB_PASSWORD'] ?? '')}@${process.env['DB_HOST']}:${process.env['DB_PORT'] ?? '3306'}/${process.env['DB_NAME']}`
    : '');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
});
