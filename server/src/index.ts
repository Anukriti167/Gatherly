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
        type SmtpError = Error & {
          code?: string;
          responseCode?: number;
          command?: string;
          response?: string;
          errno?: string;
          syscall?: string;
          address?: string;
          port?: number;
        };

        const error = err instanceof Error
          ? err as SmtpError
          : undefined;

        // AggregateError can contain multiple underlying socket errors.
        const aggregate = err instanceof AggregateError
          ? err
          : undefined;

        const underlyingErrors = aggregate?.errors.map((item: unknown) => {
          const socketError = item instanceof Error
            ? item as SmtpError
            : undefined;

          return {
            name: socketError?.name ?? 'UnknownError',
            message: socketError?.message ?? String(item),
            code: socketError?.code,
            errno: socketError?.errno,
            syscall: socketError?.syscall,
            address: socketError?.address,
            port: socketError?.port,
          };
        }) ?? [];

        const details = {
          name: error?.name ?? 'UnknownError',
          message: error?.message ?? String(err),
          code: error?.code,
          responseCode: error?.responseCode,
          command: error?.command,
          response: error?.response,
          errno: error?.errno,
          syscall: error?.syscall,
          address: error?.address,
          port: error?.port,
          underlyingErrors,
        };

        logger.error(
          `SMTP verification failed: ${JSON.stringify(details)}`,
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
