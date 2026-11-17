# Gatherly

**Collaborative multi-activity event planning with personalised guest
websites.**

Gatherly is an event-management application designed for events that
contain multiple activities. An organiser can create a parent event,
manage its activities and guest list, coordinate co-organisers, collect
RSVPs, and share a private guest experience. Guests access the event
through invitation-based links without needing to create a Gatherly
account.

> **Project status:** Active development. Some capabilities may still be
> evolving. See the repository and release notes for the current
> implementation status.

## Contents

-   [Overview](#overview)
-   [Key capabilities](#key-capabilities)
-   [Application architecture](#application-architecture)
-   [Technology stack](#technology-stack)
-   [Repository structure](#repository-structure)
-   [Getting started](#getting-started)
-   [Environment configuration](#environment-configuration)
-   [Database commands](#database-commands)
-   [Development commands](#development-commands)
-   [Testing](#testing)
-   [Guest access and microsites](#guest-access-and-microsites)
-   [Security and privacy](#security-and-privacy)
-   [Deployment](#deployment)
-   [Contributing](#contributing)

## Overview

Many real-world events are made up of smaller activities. A wedding may
include a Haldi ceremony, Mehendi, a wedding ceremony and a reception. A
conference may include several talks, workshops and networking sessions.

Gatherly models this using a **parent event** containing one or more
**activities**. Each activity can have its own schedule and information,
while organisers manage a shared guest list at the parent-event level.

The platform is intended to make event coordination collaborative for
organisers and straightforward for guests.

## Key capabilities

### Event and activity management

-   Create and manage events with event details, dates, timezone and
    organiser information.
-   Organise an event into multiple activities.
-   Maintain activity-specific schedules and details, such as itinerary,
    menu, dress code, theme and instructions.
-   Use URL-friendly event and activity slugs for guest-facing pages.

### Collaboration and publication workflow

-   Support an event owner and co-organisers.
-   Manage event planning and proposals.
-   For initial publication, require approval from the event owner and
    all co-organisers in the approval group.
-   Track approvals against the event version submitted for approval.
-   Return an event to Draft when changes are requested.
-   Invalidate approvals for a pending version when the event is edited,
    so the revised version can be reviewed afresh.

### Guest management and RSVP

-   Maintain one guest list for the parent event.
-   Assign guests to the activities they are invited to attend.
-   Send invitations and allow guests to access their invitation without
    creating an account.
-   Collect activity-level RSVP responses.
-   Send RSVP confirmation and event-related emails.
-   Keep guest contact details restricted to event administrators.

### Personalised guest websites

-   Provide a guest-facing event microsite.
-   Provide activity pages for activities assigned to the guest.
-   Scope guest-facing information to the active guest session and the
    guest's activity assignments.
-   Allow guests to revisit their event information while their
    invitation access remains valid.

### Photos and gallery

-   Support event photo uploads and an event gallery.
-   Allow organisers to review guest-submitted photos before
    publication.
-   Keep photo access behind authorised application routes rather than
    exposing storage files directly.
-   Support event-level and activity-associated photos.

### Additional event features

The broader product specification also covers event history,
notifications, proposals, calendar exports, venue information and
post-event access. Check the current implementation before relying on
any individual capability in a production workflow.

## Application architecture

Gatherly is organised as an npm-workspaces monorepo with three packages:

``` text
gatherly/
├── client/       # React frontend
├── server/       # Express API and application services
├── shared/       # Shared TypeScript types and validation
├── package.json
└── package-lock.json
```

At a high level:

``` text
Browser
   |
   v
React application (Vite)
   |
   | /api requests
   v
Express API
   |
   +---- Application modules and business rules
   |
   +---- Prisma ORM / database adapter
   |          |
   |          v
   |        MySQL
   |
   +---- Email delivery
   |
   +---- Authorised photo storage
```

The frontend and API are served from the same application origin in the
hosted setup. During local development, Vite serves the frontend and
proxies API requests to the Express server.

## Technology stack

  Area                           Technologies
  ------------------------------ ----------------------------------------------
  Language                       TypeScript
  Frontend                       React 19, React Router, TanStack Query
  Frontend tooling and styling   Vite, Tailwind CSS
  Backend                        Node.js, Express 5
  Validation                     Zod
  Database access                Prisma ORM
  Hosted database                MySQL using Prisma's MariaDB adapter
  Email                          Nodemailer and configured email gateway/SMTP
  Testing                        Vitest, Supertest
  Build tooling                  npm workspaces, tsup

The repository has previously included local PostgreSQL-oriented
configuration during development. The current GoDaddy deployment
configuration uses managed MySQL. Use the database provider and
environment variables configured for the environment you are working
with.

## Repository structure

``` text
.
├── client/
│   └── src/
│       ├── features/       # Feature-specific UI and hooks
│       ├── pages/          # Application pages
│       ├── lib/            # Frontend utilities and API client
│       └── ...
├── server/
│   ├── prisma/
│   │   ├── migrations/     # Database migrations
│   │   └── schema.prisma   # Data model
│   ├── scripts/            # Operational and maintenance scripts
│   ├── src/
│   │   ├── modules/        # Backend domain modules
│   │   ├── middleware/
│   │   ├── config/
│   │   └── lib/
│   └── test/
│       ├── unit/
│       └── integration/
├── shared/
│   └── src/                # Shared types, schemas and utilities
├── package.json
└── package-lock.json
```

The exact contents may change as the project evolves.

## Getting started

### Prerequisites

-   Node.js 20 or later (use the Node.js version supported by the
    deployment environment).
-   npm.
-   A database instance supported by the active Prisma
    adapter/configuration.
-   Git.

### 1. Clone the repository

``` bash
git clone https://github.com/<your-github-username>/<your-repository>.git
cd <your-repository>
```

### 2. Install dependencies

Run this from the repository root:

``` bash
npm install
```

The project uses npm workspaces, so install dependencies once from the
root.

### 3. Configure environment variables

Create the server environment file:

``` bash
cp server/.env.example server/.env
```

On Windows PowerShell:

``` powershell
Copy-Item server/.env.example server/.env
```

Update the database and email settings for your local environment. Do
not commit `.env` files or real credentials.

### 4. Generate the Prisma client

``` bash
npm run db:generate
```

### 5. Apply database migrations

For a local development database, use:

``` bash
npm run db:migrate
```

This invokes the server workspace's Prisma development migration
command. Make sure the configured database is the intended local
development database before running it.

### 6. Start the application

``` bash
npm run dev
```

The root development script starts the frontend and backend
concurrently. The default local setup uses:

-   Frontend: `http://localhost:5173`
-   Backend API: `http://localhost:3000`

Open the frontend URL in your browser.

## Environment configuration

The backend validates its configuration at startup. The main variables
are listed below; consult `server/.env.example` and
`server/src/config/env.ts` for the exact current schema and defaults.

  -----------------------------------------------------------------------
  Variable                            Purpose
  ----------------------------------- -----------------------------------
  `NODE_ENV`                          Runtime environment (`development`,
                                      `test` or `production`)

  `PORT`                              HTTP server port; the hosting
                                      platform may supply this

  `LOG_LEVEL`                         Application log verbosity

  `APP_ORIGIN`                        Public application origin used for
                                      links and origin checks

  `DATABASE_URL`                      Database connection URL, when using
                                      URL-based configuration

  `DB_HOST`                           Managed database host alternative

  `DB_PORT`                           Managed database port

  `DB_NAME`                           Managed database name

  `DB_USER`                           Managed database username

  `DB_PASSWORD`                       Managed database password

  `TRUST_PROXY`                       Configure Express proxy trust when
                                      running behind a reverse proxy

  `SMTP_HOST`                         SMTP server host, if SMTP is used

  `SMTP_PORT`                         SMTP server port

  `SMTP_SECURE`                       Whether SMTP uses a secure
                                      connection

  `SMTP_USER`                         SMTP username

  `SMTP_PASSWORD`                     SMTP password

  `MAIL_FROM`                         Sender identity for outgoing email

  `CONTACT_INBOX`                     Destination for contact-form
                                      submissions

  `RATE_LIMIT_ENABLED`                Enables or disables configured rate
                                      limiting

  `EMAIL_RATE_PER_MINUTE`             Outgoing email rate limit

  `STORAGE_DIR`                       Directory used for uploaded photo
                                      storage

  `ANTHROPIC_API_KEY`                 Optional key for AI-related
                                      capabilities
  -----------------------------------------------------------------------

For GoDaddy's managed MySQL configuration, the application can build its
database connection from `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and
`DB_PASSWORD`. Alternatively, configure `DATABASE_URL` where
appropriate.

**Never put secrets in source code, README examples, screenshots,
commits or frontend environment variables.** Set production secrets
through the hosting provider's environment/secrets settings.

## Database commands

Run these commands from the repository root:

  -----------------------------------------------------------------------
  Command                             Purpose
  ----------------------------------- -----------------------------------
  `npm run db:generate`               Generate the Prisma client

  `npm run db:migrate`                Run the server's development
                                      migration workflow
  -----------------------------------------------------------------------

The server workspace also defines deployment-oriented Prisma commands.
Production migrations should be applied only as part of a deliberate
deployment process and against the intended database.

**Important:** Back up production data before applying schema changes.
Do not use development migration commands against a production database.

## Development commands

Run from the repository root:

  -----------------------------------------------------------------------
  Command                             Purpose
  ----------------------------------- -----------------------------------
  `npm run dev`                       Start frontend and backend in
                                      development mode

  `npm run build`                     Build the client and server

  `npm run start`                     Start the server workspace

  `npm run typecheck`                 Type-check shared, server and
                                      client workspaces

  `npm test`                          Run the server test suite

  `npm run db:generate`               Generate Prisma client

  `npm run db:migrate`                Run local development migrations
  -----------------------------------------------------------------------

Useful workspace-specific commands:

``` bash
npm run dev -w client
npm run dev -w server
npm run test -w server
npm run test:watch -w server
npm run typecheck -w client
npm run typecheck -w server
npm run typecheck -w shared
```

## Testing

The backend test suite uses Vitest and Supertest. Tests are organised
into unit and integration suites under `server/test`.

Run the test suite:

``` bash
npm test
```

Run tests in watch mode:

``` bash
npm run test:watch -w server
```

Run type checks across all workspaces:

``` bash
npm run typecheck
```

Build the application:

``` bash
npm run build
```

Use a dedicated test database and test configuration. Never point
destructive test setup at a production database.

## Guest access and microsites

Guest access is invitation-based:

1.  An organiser adds a guest to an event and assigns the guest to one
    or more activities.
2.  Gatherly sends an invitation containing a private invitation link.
3.  The guest opens the link.
4.  The backend exchanges the invitation token for a guest session and
    sets a guest-specific cookie.
5.  The guest can access event and activity information permitted by
    their invitation and activity assignments.

Guest-facing routes use URL slugs rather than internal database IDs. The
route patterns are:

``` text
/e/:eventSlug
/e/:eventSlug/a/:activitySlug
```

For example, if an event slug is `sample-wedding` and an activity slug
is `mehendi`, the URLs are:

``` text
https://your-domain.example/e/sample-wedding
https://your-domain.example/e/sample-wedding/a/mehendi
```

The exact slugs are generated/stored by the application. Do not assume
that a display name always maps to a particular slug; use the stored
slug for the event and activity.

The guest microsite API checks the active guest session and enforces
activity assignment on the server. A successful RSVP email is not, by
itself, proof that a guest microsite request is authorised.

## Security and privacy

Gatherly handles private event information and guest contact details.
Important design principles include:

-   Event information is restricted to authorised organisers and invited
    guests.
-   Guest-facing API responses are scoped to the active guest session.
-   Guests should only see activities to which they have been assigned.
-   Guest contact details are restricted to event administrators.
-   Invitation and session tokens must be treated as secrets.
-   Guest sessions use a separate cookie from organiser sign-in.
-   Uploaded photos are served through authorised application routes.
-   Request validation and rate limiting are applied at the API
    boundary.
-   Production secrets belong in the hosting provider's
    secret/environment configuration.

Do not share invitation URLs, session cookies, database credentials,
SMTP passwords or guest CSV exports publicly.

## Deployment

The application has been deployed using GoDaddy Node.js Hosting.

The root project is an npm-workspaces application. The root scripts
provide the build and start entry points:

``` bash
npm run build
npm start
```

For GoDaddy deployment:

1.  Configure the app's Node.js runtime and environment variables in the
    GoDaddy dashboard.
2.  Ensure the deployment package contains the required application
    files, workspace manifests, lockfile, Prisma schema and migrations,
    and built assets as required by the selected deployment workflow.
3.  Configure the managed MySQL connection using the database
    credentials supplied by GoDaddy.
4.  Set `APP_ORIGIN` to the exact HTTPS origin used by the deployed
    application.
5.  Configure email delivery settings or the hosting provider's
    supported email gateway.
6.  Deploy to Preview and inspect runtime logs and application
    behaviour.
7.  Verify organiser sign-in, invitation delivery, guest-session
    creation, RSVP submission and guest microsite access.
8.  Publish only after the Preview deployment has been tested.

The hosted application must listen on the port supplied by the platform
through `process.env.PORT` (or the validated `PORT` configuration).

Preview and Live may share managed resources depending on the hosting
configuration. Confirm the database and storage behaviour in the GoDaddy
dashboard before running migrations or testing operations that modify
data.

## Contributing

Contributions and improvements are welcome.

A useful workflow is:

1.  Create a branch for the change.
2.  Keep domain logic in the appropriate server module.
3.  Put reusable contracts and validation in `shared` when they need to
    be used by both client and server.
4.  Add or update tests for changed behaviour.
5.  Run type checks and tests.
6.  Review database migrations carefully before deploying.
7.  Open a pull request describing the change and its impact.

## Project vision

Gatherly aims to make complex, multi-part events easier to plan and more
personal to attend --- giving organisers a collaborative workspace and
giving every guest a simple, private view of the activities that matter
to them.

------------------------------------------------------------------------

**Built with TypeScript, React, Node.js and Prisma.**
