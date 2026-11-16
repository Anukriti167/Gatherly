import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '../generated/prisma/client.ts';

export type { PrismaClient };
export * as db from '../generated/prisma/client.ts';

/**
 * MySQL via Prisma's MariaDB/MySQL driver adapter (pure JavaScript — nothing to compile on the
 * host). GoDaddy Node.js hosting only allows its managed MySQL database.
 */
export function createPrisma(databaseUrl: string): PrismaClient {
  const url = new URL(databaseUrl);
  const adapter = new PrismaMariaDb({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: 10,
    // MySQL 8's default auth plugin needs the server key when not using TLS on localhost/loopback.
    allowPublicKeyRetrieval: true,
  });
  return new PrismaClient({ adapter });
}
