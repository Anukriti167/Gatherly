import { createApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config/env.ts';
import { createLogger } from './lib/logger.ts';
import { createMailer, SmtpMailer } from './lib/mailer.ts';
import { createPrisma } from './lib/prisma.ts';

loadDotEnv();

const config = loadConfig();
const logger = createLogger(config);
const prisma = createPrisma(config.databaseUrl);
const mailer = createMailer(config, logger);

const app = createApp({ config, prisma, mailer, logger });

const server = app.listen(config.port, () => {
  logger.info(`Gatherly server listening on port ${config.port} (${config.env})`);

  if (!config.mail.smtp) {
    logger.warn('SMTP not configured — emails will be printed to the log');
    return;
  }

  // Verify SMTP connection and authentication without sending an email.
  if (mailer instanceof SmtpMailer) {
    void mailer.verify()
      .then(() => {
        logger.info('SMTP connection and authentication verified successfully');
      })
      .catch((err: unknown) => {
        const error = err instanceof Error
          ? err as Error & {
              code?: string;
              responseCode?: number;
              command?: string;
            }
          : undefined;

        logger.error(
          {
            errorName: error?.name ?? 'UnknownError',
            errorMessage: error?.message ?? String(err),
            smtpCode: error?.code,
            smtpResponseCode: error?.responseCode,
            smtpCommand: error?.command,
          },
          'SMTP verification failed',
        );
      });
  }
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
