import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Load server/.env for CLI commands (migrate, studio). Existing env vars take precedence.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? '',
  },
});
