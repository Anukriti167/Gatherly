import { createApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config/env.ts';
import { createLogger } from './lib/logger.ts';
import { createMailer } from './lib/mailer.ts';
import { createPrisma } from './lib/prisma.ts';

loadDotEnv();
const config = loadConfig();
const logger = createLogger(config);
const prisma = createPrisma(config.databaseUrl);
const mailer = createMailer(config, logger);

const app = createApp({ config, prisma, mailer, logger });
const server = app.listen(config.port, () => {
  logger.info(`Gatherly server listening on port ${config.port} (${config.env})`);
  if (!config.mail.smtp) logger.warn('SMTP not configured — emails will be printed to the log');
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
