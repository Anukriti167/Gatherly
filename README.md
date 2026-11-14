# Gatherly

**Plan multi-activity events together, and give every guest their own personal event website.**

Gatherly is for families, creators and small businesses who organise events with several parts —
a wedding weekend (haldi, sangeet, reception), a conference (keynote, workshops, dinner), a birthday
with a brunch and a party. Organisers plan together and **every important decision needs everyone's
approval**. Guests need no account: each gets a secure personal link showing only the activities
they're invited to — schedule, venue and directions, menu, dress code, RSVP, calendar export and a
shared photo gallery.

Built for the **GoDaddy Inclusive Innovation Hackathon 2026**, to run entirely on GoDaddy hosting.

---

## Contents

1. [Features](#features)
2. [Product decisions](#product-decisions)
3. [Technical decisions](#technical-decisions)
4. [Requirements status](#requirements-status)
5. [Tech stack & architecture](#tech-stack--architecture)
6. [Running locally](#running-locally)
7. [Testing](#testing)
8. [Configuration](#configuration)
9. [Security & privacy](#security--privacy)
10. [Roadmap](#roadmap)

---

## Features

### Accounts
- Register, sign in / out, change password, profile (name, optional phone).
- Password reset by email — single-use, 1-hour links; the newest link only; all devices signed out after a reset.
- Email confirmation (used to safely match accounts to guest invitations).
- **Dashboard** with tabs **Upcoming · Ongoing · Completed · Cancelled**, showing events you organise
  *and* events you're invited to as a guest (labelled **✉ Invited**; one click opens your guest page).

### Events & activities
- Create events with name, type, optional Formal/Informal planning style, timezone, dates, description.
- **Activities** inside each event, each with its own date, time and **timezone**.
- **Single-page activity editor** — everything for an activity on one form, saved with one click:
  - **Where:** venue name, location, and a **live Google Map preview** (free, keyless embed); online meeting link;
    **copy location from another activity**; new activities pre-fill the last location used.
  - **RSVP:** optional capacity and RSVP deadline.
  - **Itinerary:** timed entries, always shown in time order (warns when outside the activity's hours).
  - **Menu:** categories (one-click Starters / Main Course / Desserts / Beverages) with dishes and dietary tags
    (Vegetarian, Vegan, Jain, Non-vegetarian, Gluten-free, Contains nuts, Contains dairy, Spicy, or your own).
  - **Speakers & performers**, **dress code & theme** (with colour swatches), **instructions**.
  - A **"Show to guests"** switch per section.
- Each activity card on the event page shows a summary and expands to the full details.
- **Tabbed event page:** Overview · Activities · Guests · Organisers · Proposals · Photos · History, with live
  counts and a **"Needs you"** strip whenever something is waiting on you.

### Organisers & approvals
- **Co-admins:** the owner invites registered users by email; they accept or decline from their dashboard;
  the owner can remove them. Co-admins can do everything except manage organisers.
- **Publishing needs everyone's approval.** Submitting moves the event to *Pending Approval*; each organiser
  approves the exact version or requests changes (back to Draft with a note). Any edit while pending resets
  approvals. A sole organiser publishes immediately.
- **Change proposals on published events:** remove guests, **unpublish**, **cancel**, or **mark as completed
  early**. Organisers approve or **object** (an objection doesn't reject — it stays open for discussion), comment,
  and the proposer can **revise** (approvals reset) or **withdraw**. Applied automatically once everyone approves
  the same version.
- **Automatic completion:** a published event becomes *Completed* once it ends; activities complete as they end.

### Guests
- Add guests manually or **import a CSV** with a downloadable template (`Name, Email, Phone, Activities`).
  - The **Activities** column takes `All` or activity names separated by `;` — each guest can have different activities.
  - **Preview before saving:** every row is checked; duplicates and typos (e.g. *"Unknown activity "Sangeeth""*)
    are flagged and skipped.
- Assign guests to specific activities or **All activities** (including ones added later).
- Filter by activity (**All guests** chip + one per activity with counts and RSVP tallies), search.
- Phone numbers are visible to organisers only.

### Invitations & the guest website
- **✉ Send invitations** — one personal, secure link per guest. Per guest: Invite / Resend / **Revoke link**,
  with status *Not invited · Sending… · Invited · Opened 2 h ago · Email failed (retry) · Revoked*.
- Invitation emails list only that guest's activities.
- The guest's page (`/my-event`, opened via `/i/<link>` — no account) shows the event, **their personal
  schedule** across their activities, and each activity's details with a live map, directions, join-online
  link, itinerary, menu and dress code.
- **RSVP per activity** — *I'll be there* / *Can't make it*, changeable until the deadline; capacity enforced;
  confirmation email for each answer.
- **📅 Add to calendar** (`.ics`) per activity or for the whole schedule.
- Unpublished events show *"This event is being updated"*; cancelled and completed events show a banner.

### Photo gallery
- Organisers upload many photos at once with captions and activity tags; they go live immediately.
- **Guest photo sharing** (switch, off by default): up to **20 photos per guest**, held for **approval**
  (Approve / Reject with a note / Approve all); guests are emailed the decision.
- Every invited guest can browse all approved photos of the event, filter by activity, open a **lightbox**
  (← → Esc) and **download**.

### Staying informed
- **🔔 Notification bell** (unread count, latest updates, full history page) — every organiser update is
  stored in-app *and* emailed; each links straight to the right tab or proposal.
- **Needs your attention** on the dashboard: publishing approvals, proposals and guest photos waiting on you.
- **History tab:** a readable, filterable timeline of everything that happened on the event, grouped by day.
- Screens **refresh automatically** every 15 s (and when you return to the tab).

---

## Product decisions

Decisions taken with the product owner while building, on top of the
[functional requirements](docs/functional-requirements.txt):

**Platform**
- **GoDaddy only, nothing paid.** No outside services (managed databases, cloud storage, map/weather APIs) and
  nothing that needs billing. Maps use Google's free keyless embed and plain Maps links; venue search
  (FR-186–188) is replaced by typing the location, and weather (FR-192) is dropped.
- **AI features are optional and not agentic for now** (FR-211–216 not built yet).

**Approvals**
- The person who submits or proposes **counts as approving**, so a sole organiser acts immediately.
- Approvals bind to an **exact version**; any edit while pending resets them (FR-143, FR-228).
- The approver list is **fixed when a round starts** (FR-224, FR-146): people who join later aren't required.
  If a required approver is **removed**, the publication round restarts and open proposals stop waiting for them,
  so nothing stalls.
- **After publishing**, event details and activities change only through a proposal. Invitations,
  announcements, suggestion replies and photo moderation stay direct; cover images stay direct (FR-046, FR-153).
- **Unpublishing** (not in the FRS) needs everyone's approval; the event returns to Draft and guests see
  *"This event is being updated"* until it's re-published.
- **Completing early** is a proposal, only once the event has started; activities that never started are cancelled.

**Guests**
- **Adding and editing guests — including activity assignments — is direct at any time**, before or after
  publishing. **Removing a guest after publishing needs everyone's approval**, because it cuts off their access.
- The guest list is **not part of the approved content**: guest changes don't bump the event version or reset
  pending approvals.
- **Every guest change is emailed to the other organisers**, listing exactly what changed
  (e.g. *"No longer invited to: Sangeet"*).
- **Invitations are generic:** one personal link per guest covering all their activities (FR-086).
  Re-sending replaces the link; there is deliberately **no bulk re-send** (it would break every link already sent).
- Invited events appear on a user's dashboard only for a **confirmed email** — nobody can see someone else's
  invitation by signing up with their address. Email confirmation was added for this (not in the FRS).
- In the gallery, guests see other guests as **short names** ("Priya S."), never emails or phones.

**Notifications**
- RSVPs notify organisers **in-app only** (no email per RSVP); guests get a confirmation email.
- Guest photos to review appear once per event in *Needs your attention*, not as one notification per photo.

**Layout**
- One page for each activity (no extra clicks), a tabbed event page so nothing piles up, and "(optional)" on
  individual fields rather than section titles.

---

## Technical decisions

| Decision | Why |
|---|---|
| **npm-workspaces monorepo** (`client`, `server`, `shared`) | One repo; **shared Zod schemas, types and the permission policy** are used by both sides, so validation and rules can't drift. |
| **Express serves the built React app** | One process, one origin — no CORS, simple cookies, fits GoDaddy Node.js hosting. |
| **Prisma 7 with the query compiler** + `@prisma/adapter-pg` | No platform-specific engine binary to break on the host. |
| **Node's built-in `scrypt`** for passwords | Strong and memory-hard with no native add-on to compile on the host. |
| **Server-side sessions**, tokens stored as **SHA-256 hashes** | Instant sign-out and revocation; a database leak exposes no live tokens. Guests get a separate cookie. |
| **One permission table** (`shared/src/domain/event-policy.ts`) | "Who can do what, in which status" lives in one place; the server enforces it, the UI uses it to show controls. |
| **Every event edit goes through one path** (`EventsService.runEdit`) | Permission check, optimistic version check and version bump in one transaction, so approvals can't be bypassed. |
| **Approval engine** shared by publishing and proposals | Snapshot approvers, version-bound decisions, unanimous apply. |
| **Database-backed email outbox** with an in-process worker | Rate-limited sending (protects the Titan mailbox), retries with back-off, visible delivery status (FR-160). |
| **In-process background jobs** (outbox, completion sweep) | The host runs a single process; no Redis or separate workers needed. |
| **Images resized in the browser**; server checks magic bytes and strips metadata | Smaller uploads on mobile, GPS removed, and **no native image library** on the server. |
| **Storage adapter** for photos (local disk now) | Can switch to database storage if the host's disk doesn't persist, without touching callers. |
| **Polling (15 s) instead of websockets** | Simple and reliable on shared hosting; good enough at this scale. |
| **Readable audit log** | Every action is recorded once and reused for the History tab and accountability (FR-197–199). |

---

## Requirements status

Against the 230 requirements in [`docs/functional-requirements.txt`](docs/functional-requirements.txt):

| Area | FRs | Status |
|---|---|---|
| Accounts | 001–007 | ✅ Done (profile image: later) |
| Events | 008–018 | ✅ Done |
| Activities & activity details | 019–036 | ✅ Done |
| Cover images | 037–046 | ⏳ Not yet |
| Templates | 047–059, 220 | ⏳ Planning style stored; templates not yet |
| Owner & co-admins | 060–067 | ✅ Done (ownership transfer FR-065: later) |
| Guests & assignments | 068–082 | ✅ Done (CSV; direct `.xlsx` later) |
| Invitations & guest access | 083–093 | ✅ Done |
| Personalised guest website | 094–108 | ✅ Done, except announcements (103) and suggestions (104) sections |
| RSVP | 109–119 | ✅ Done |
| Guest suggestions | 120–131 | ⏳ Not yet |
| Change proposals | 132–153 | 🟡 Engine done for guest removal, unpublish, cancel, complete; event-detail & activity changes not yet |
| Announcements & notifications | 154–160 | 🟡 Delivery status and confirmations done; announcements not yet |
| Photo gallery | 161–178, 217 | ✅ Done |
| Event history | 179–185 | ✅ Done |
| Integrations | 186–196 | 🟡 Maps link, `.ics`, meeting links, email, manual entry done; venue search replaced (decision); weather dropped; meeting-provider integration deferred (FR-194) |
| Audit, security & privacy | 197–205 | ✅ Done |
| Public website & contact form | 206–210 | 🟡 Landing page done; contact form not yet |
| AI (optional) | 211–216 | ⏳ Not built (decision) |
| Other confirmed | 217–221 | ✅ 217, 218, 221 done · 219 custom URL deferred (FRS) · 220 with templates |
| Initial publication approval | 222–230 | ✅ Done |

---

## Tech stack & architecture

- **Client:** React 19, Vite, Tailwind CSS 4, React Router, TanStack Query
- **Server:** Node.js, Express 5, Prisma 7, PostgreSQL 17, Zod, Nodemailer, Pino, Multer
- **Shared:** Zod schemas, domain types, the permission policy, timezone, CSV and map helpers
- **Tests:** Vitest + Supertest against a real PostgreSQL test database

```
client/   React app — pages/, features/<area>/ (hooks + components), components/, lib/
server/   Express API — src/modules/<area>/ (service + routes), src/lib/, src/middleware/
          prisma/schema.prisma + migrations, test/unit, test/integration
shared/   schemas/, domain/ (enums, event-policy), types/, time.ts, csv.ts
docs/     functional requirements and hackathon guide
```

Server modules: `auth`, `users`, `events`, `activities`, `memberships`, `publication`, `proposals`, `guests`,
`invitations`, `guest-portal`, `rsvp`, `photos`, `notifications`, `outbox`, `completion`, `audit`.

---

## Running locally

**Prerequisites:** Node.js 20+ (LTS) and PostgreSQL 17.

```bash
npm install
cp server/.env.example server/.env        # then set DATABASE_URL / TEST_DATABASE_URL passwords
npm run db:migrate                        # creates tables and generates the Prisma client
npm run dev                               # API on :3000, web app on http://localhost:5173
```

- Until SMTP is configured, **emails are printed to the server log** (with their links).
- Test the GoDaddy (Titan) mailbox: `npm run mail:test -w server -- you@example.com`.
- Production build: `npm run build`, then `npm start` (Express serves the built client).

---

## Testing

```bash
npm test            # 268 unit + integration tests
npm run typecheck   # all three workspaces
```

Integration tests use a separate `gatherly_test` database (created automatically, never the development one)
and cover the security-sensitive paths: access control, privacy of guest data, approval rules, capacity under
concurrency, token handling, upload validation and metadata stripping.

---

## Configuration

`server/.env` (see `server/.env.example`; never committed):

| Variable | Purpose |
|---|---|
| `APP_ORIGIN` | Public URL (links in emails, CSRF origin check). Must be `https://` in production. |
| `DATABASE_URL`, `TEST_DATABASE_URL` | PostgreSQL connections (the test one is emptied by tests). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM` | Titan mailbox. `MAIL_FROM` must be the same mailbox as `SMTP_USER`. If login fails on `smtp.titan.email`, use `smtpout.secureserver.net`. |
| `CONTACT_INBOX` | Mailbox that receives contact-form messages. |
| `EMAIL_RATE_PER_MINUTE` | Outbox sending rate (default 20). |
| `STORAGE_DIR` | Folder for uploaded photos (must persist between deploys). |
| `TRUST_PROXY` | Proxy hops in front of the app on the host. |
| `RATE_LIMIT_ENABLED`, `LOG_LEVEL`, `PORT`, `NODE_ENV` | Runtime settings. |

---

## Security & privacy

- **Authorisation on every request** through one policy; non-members get *not found*, not *forbidden*.
- **Guests only ever see their own data** — never other guests' emails or phone numbers; hidden sections are
  removed, not just hidden. Revoking an invitation or removing a guest ends their access immediately.
- **Tokens** (sessions, reset, confirmation, invitations) are 256-bit random values stored only as hashes;
  invitation tokens are exchanged for a cookie and removed from the address bar.
- **CSRF:** SameSite cookies plus an Origin check on every state-changing request.
- **Input validation** with Zod on the server for every endpoint; field-level errors.
- **Uploads:** real type checked by content, size and pixel limits, metadata (incl. GPS) stripped, files served
  only through an access-checked route.
- **Rate limits** on sign-in, registration, resets, invitation links, co-admin invites and uploads.
- **Helmet** security headers and a Content-Security-Policy (only Google's map frame is allowed).
- **Concurrency safety:** optimistic versioning for edits, row locks for RSVP capacity, conditional updates for
  approvals.
- **Secrets** only in `server/.env` (git-ignored); passwords hashed with scrypt.

---

## Roadmap

1. **Deploy to GoDaddy** — Node.js hosting, own domain with HTTPS, Titan mailbox.
2. **Contact form** on the public site → the domain mailbox (FR-208–210).
3. **Change proposals for event details and activities** on published events.
4. **Announcements** (FR-154–159) and **guest suggestions** (FR-120–131).
5. Cover images and templates; ownership transfer; `.xlsx` import; optional AI helpers.
