import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import type { AppConfig } from './config/env.ts';
import type { Logger } from './lib/logger.ts';
import type { Mailer } from './lib/mailer.ts';
import type { PrismaClient } from './lib/prisma.ts';
import { loadSession } from './middleware/authenticate.ts';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler.ts';
import { originCheck } from './middleware/origin-check.ts';
import { createRateLimiters } from './middleware/rate-limit.ts';
import { activitiesRoutes } from './modules/activities/activities.routes.ts';
import { ActivitiesService } from './modules/activities/activities.service.ts';
import { AuditService } from './modules/audit/audit.service.ts';
import { historyRoutes } from './modules/audit/history.routes.ts';
import { EventHistoryService } from './modules/audit/history.service.ts';
import { CompletionService } from './modules/completion/completion.service.ts';
import { authRoutes } from './modules/auth/auth.routes.ts';
import { AuthService } from './modules/auth/auth.service.ts';
import { SessionService } from './modules/auth/session.service.ts';
import { eventsRoutes } from './modules/events/events.routes.ts';
import { EventsService } from './modules/events/events.service.ts';
import { guestsRoutes } from './modules/guests/guests.routes.ts';
import { GuestsService } from './modules/guests/guests.service.ts';
import { guestPortalRoutes } from './modules/guest-portal/guest-portal.routes.ts';
import { GuestAccessService } from './modules/guest-portal/guest-access.service.ts';
import { healthRoutes } from './modules/health/health.routes.ts';
import { invitationsRoutes } from './modules/invitations/invitations.routes.ts';
import { InvitationsService } from './modules/invitations/invitations.service.ts';
import { OutboxService } from './modules/outbox/outbox.service.ts';
import { rsvpRoutes } from './modules/rsvp/rsvp.routes.ts';
import { RsvpService } from './modules/rsvp/rsvp.service.ts';
import { membershipsRoutes, myInvitationsRoutes } from './modules/memberships/memberships.routes.ts';
import { MembershipsService } from './modules/memberships/memberships.service.ts';
import { meRoutes } from './modules/notifications/notifications.routes.ts';
import { NotificationsService } from './modules/notifications/notifications.service.ts';
import { proposalsRoutes } from './modules/proposals/proposals.routes.ts';
import { ProposalsService } from './modules/proposals/proposals.service.ts';
import { publicationRoutes } from './modules/publication/publication.routes.ts';
import { PublicationService } from './modules/publication/publication.service.ts';
import { usersRoutes } from './modules/users/users.routes.ts';
import { UsersService } from './modules/users/users.service.ts';

export interface AppDeps {
  config: AppConfig;
  prisma: PrismaClient;
  mailer: Mailer;
  logger: Logger;
}

/** Composition root: builds services and wires routes. Kept free of side effects for testing. */
export function createApp({ config, prisma, mailer, logger }: AppDeps): Express {
  // Services, constructed in dependency order.
  const sessions = new SessionService(prisma, config);
  const audit = new AuditService(prisma);
  const events = new EventsService(prisma, audit);
  const notifications = new NotificationsService(prisma, mailer, logger);
  const outbox = new OutboxService(prisma, mailer, logger, config.emailRatePerMinute);
  const services = {
    sessions,
    audit,
    events,
    auth: new AuthService(prisma, sessions, mailer, config, logger),
    users: new UsersService(prisma),
    activities: new ActivitiesService(prisma, events, audit),
    notifications,
    memberships: new MembershipsService(prisma, events, audit, notifications, config),
    publication: new PublicationService(prisma, events, audit, notifications, config),
    guests: new GuestsService(prisma, events, audit, notifications, config),
    proposals: new ProposalsService(prisma, events, audit, notifications, config),
    history: new EventHistoryService(prisma, events),
    completion: new CompletionService(prisma, audit, notifications, config, logger),
    outbox,
    invitations: new InvitationsService(prisma, events, audit, outbox, config),
    guestAccess: new GuestAccessService(prisma, config),
    rsvp: new RsvpService(prisma, events, audit, outbox, notifications, config),
  };
  // Automatic completion of finished events/activities (FR-017, FR-018). Tests call run() directly.
  if (config.env !== 'test') {
    services.completion.start();
    services.outbox.start(); // sends queued emails (invitations, RSVP confirmations) at a limited rate
  }
  const limits = createRateLimiters(config.rateLimitEnabled);

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          // Free keyless Google Maps embed for venue previews (no API key, no billing).
          'frame-src': ['https://www.google.com', 'https://maps.google.com'],
          'upgrade-insecure-requests': config.isProduction ? [] : null,
        },
      },
      strictTransportSecurity: config.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  if (config.env !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/v1/health' } }));

  // ── API ────────────────────────────────────────────────────────────────────
  const api = express.Router();
  api.use(limits.api);
  // Guest spreadsheet imports carry up to 1 MB of CSV; everything else stays small.
  api.use('/events/:eventId/guests/import', express.json({ limit: '1mb' }));
  api.use(express.json({ limit: '100kb' }));
  api.use(cookieParser());
  api.use(originCheck(config.appOrigin));
  api.use(loadSession(sessions, config.session.cookieName));
  api.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  api.use('/health', healthRoutes(prisma));
  api.use('/auth', authRoutes(services.auth, sessions, limits));
  api.use('/users', usersRoutes(services.users));
  api.use('/events/:eventId/activities', activitiesRoutes(services.activities));
  api.use('/events/:eventId/members', membershipsRoutes(services.memberships, limits));
  api.use('/invitations', myInvitationsRoutes(services.memberships));
  api.use('/me', meRoutes(services.notifications));
  api.use('/events/:eventId/history', historyRoutes(services.history));
  api.use('/events/:eventId/invitations', invitationsRoutes(services.invitations));
  api.use('/guest', guestPortalRoutes(services.guestAccess, services.rsvp, config.session.guestCookieName, limits));
  api.use('/events/:eventId/rsvps', rsvpRoutes(services.rsvp));
  api.use('/events/:eventId/publication', publicationRoutes(services.publication));
  api.use('/events/:eventId/guests', guestsRoutes(services.guests));
  api.use('/events/:eventId/proposals', proposalsRoutes(services.proposals));
  api.use('/events', eventsRoutes(services.events));
  api.use(notFoundHandler);

  app.use('/api/v1', api);

  // ── Static client (production build) ──────────────────────────────────────
  const clientDir = config.clientDistDir ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (existsSync(join(clientDir, 'index.html'))) {
    app.use(
      '/assets',
      express.static(join(clientDir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false }),
    );
    app.use(express.static(clientDir, { index: false, maxAge: '1h' }));
    // SPA fallback: any other GET renders the app shell.
    app.get('/{*path}', (_req, res) => {
      res.set('Cache-Control', 'no-cache');
      res.sendFile(join(clientDir, 'index.html'));
    });
  }

  app.use(createErrorHandler(logger));
  return app;
}
