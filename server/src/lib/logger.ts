import { pino, type Logger } from 'pino';
import type { AppConfig } from '../config/env.ts';

export type { Logger };

export function createLogger(config: Pick<AppConfig, 'logLevel' | 'isProduction' | 'env'>): Logger {
  return pino({
    level: config.env === 'test' ? 'silent' : config.logLevel,
    // Never log credentials, tokens or cookies.
    redact: {
      paths: [
        'req.headers.cookie',
        'req.headers.authorization',
        'res.headers["set-cookie"]',
        '*.password',
        '*.token',
        '*.passwordHash',
        '*.tokenHash',
      ],
      censor: '[redacted]',
    },
    transport: config.isProduction ? undefined : { target: 'pino-pretty', options: { colorize: true } },
  });
}
