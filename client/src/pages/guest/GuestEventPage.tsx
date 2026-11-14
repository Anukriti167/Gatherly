import type { GuestActivity, GuestEventView, GuestItineraryEntry } from '@gatherly/shared';
import { Link } from 'react-router';
import { Alert, Spinner } from '../../components/ui';
import { useCurrentUser } from '../../features/auth/use-auth';
import { MapPreview } from '../../components/MapPreview';
import { ActivityDetailsView } from '../../features/activities/ActivityDetailsView';
import { GuestPhotos } from '../../features/photos/GuestPhotos';
import { calendarUrl, useGuestLogout, useGuestView, useRsvp } from '../../features/guest-site/use-guest';
import { ApiError } from '../../lib/api';
import { formatDateRange, formatDateTime, timeZoneLabel } from '../../lib/format';

const dayLabel = (iso: string, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
const timeOf = (iso: string, tz: string) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

function GuestShell({ name, children }: { name?: string; children: React.ReactNode }) {
  const logout = useGuestLogout();
  const { data: account } = useCurrentUser(); // guests who also have an account came from their dashboard
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <span className="flex items-center gap-3">
            <span className="flex items-center gap-2 font-bold">
              <img src="/favicon.svg" alt="" className="size-6" /> Gatherly
            </span>
            {account && (
              <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
                ← My dashboard
              </Link>
            )}
          </span>
          {name && (
            <span className="text-sm text-slate-600">
              Hi {name.split(' ')[0]} ·{' '}
              <button type="button" onClick={() => logout.mutate()} className="font-medium text-brand-700 hover:underline">
                Not you?
              </button>
            </span>
          )}
        </div>
      </header>
      <main id="main" className="mx-auto max-w-3xl px-4 py-6 sm:py-10">
        {children}
      </main>
    </div>
  );
}

/** FR-097 — the guest's own timeline across their activities, grouped by day. */
function Schedule({ items }: { items: GuestItineraryEntry[] }) {
  const days: { day: string; entries: GuestItineraryEntry[] }[] = [];
  for (const i of items) {
    const day = dayLabel(i.startsAt, i.timezone);
    if (days.at(-1)?.day === day) days.at(-1)!.entries.push(i);
    else days.push({ day, entries: [i] });
  }
  return (
    <div className="space-y-5">
      {days.map((d) => (
        <section key={d.day}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">{d.day}</h3>
          <ol className="space-y-2 border-l-2 border-brand-100 pl-4">
            {d.entries.map((e, i) => (
              <li key={i} className="relative">
                <span className="absolute -left-[1.4rem] top-1.5 size-2.5 rounded-full bg-brand-500" aria-hidden />
                <p className="text-sm">
                  <span className="font-semibold text-slate-900">
                    {timeOf(e.startsAt, e.timezone)}
                    {e.endsAt && ` – ${timeOf(e.endsAt, e.timezone)}`}
                  </span>{' '}
                  <span className="text-slate-800">{e.title}</span>
                  {e.title !== e.activityName && <span className="text-slate-500"> · {e.activityName}</span>}
                </p>
                {e.description && <p className="text-xs text-slate-500">{e.description}</p>}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

function RsvpChip({ a }: { a: GuestActivity }) {
  if (a.status === 'CANCELLED') return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">Cancelled</span>;
  const styles = { CONFIRMED: 'bg-emerald-50 text-emerald-700', DECLINED: 'bg-slate-100 text-slate-600', PENDING: 'bg-amber-50 text-amber-800' }[a.rsvp];
  const label = { CONFIRMED: "✓ You're going", DECLINED: "You can't make it", PENDING: 'Not answered yet' }[a.rsvp];
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${styles}`}>{label}</span>;
}

/** FR-109 – FR-113 — Yes / No for one activity, with the reason when answering isn't possible. */
function RsvpPanel({ a }: { a: GuestActivity }) {
  const rsvp = useRsvp();
  const busy = rsvp.isPending && rsvp.variables?.activityId === a.id;
  const error = rsvp.error && rsvp.variables?.activityId === a.id ? (rsvp.error instanceof ApiError ? rsvp.error.message : 'Could not save your answer.') : null;
  if (a.status === 'CANCELLED') return null;

  const closedReason = !a.rsvpOpen
    ? a.rsvpDeadline && new Date(a.rsvpDeadline) <= new Date()
      ? 'The RSVP deadline has passed — contact the organisers to change your answer.'
      : 'Answers are closed for this activity.'
    : null;
  const choose = (status: 'CONFIRMED' | 'DECLINED') => rsvp.mutate({ activityId: a.id, status });
  const btn = (on: boolean, tone: 'yes' | 'no') =>
    `flex-1 rounded-xl px-4 py-3 text-sm font-semibold ring-1 transition disabled:cursor-not-allowed disabled:opacity-60 ${
      on
        ? tone === 'yes'
          ? 'bg-emerald-600 text-white ring-emerald-600'
          : 'bg-slate-700 text-white ring-slate-700'
        : 'bg-white text-slate-800 ring-slate-300 hover:bg-slate-50'
    }`;

  return (
    <div className="mt-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <p className="text-sm font-medium text-slate-800">Will you be there?</p>
      <div className="mt-2 flex gap-2" role="group" aria-label={`RSVP for ${a.name}`}>
        <button
          type="button"
          aria-pressed={a.rsvp === 'CONFIRMED'}
          disabled={!a.rsvpOpen || busy || (a.full && a.rsvp !== 'CONFIRMED')}
          onClick={() => choose('CONFIRMED')}
          className={btn(a.rsvp === 'CONFIRMED', 'yes')}
        >
          ✓ I'll be there
        </button>
        <button type="button" aria-pressed={a.rsvp === 'DECLINED'} disabled={!a.rsvpOpen || busy} onClick={() => choose('DECLINED')} className={btn(a.rsvp === 'DECLINED', 'no')}>
          Can't make it
        </button>
      </div>
      {a.full && a.rsvp !== 'CONFIRMED' && a.rsvpOpen && <p className="mt-2 text-xs text-amber-700">This activity is full. Contact the organisers if you'd like to come.</p>}
      {closedReason && <p className="mt-2 text-xs text-slate-500">{closedReason}</p>}
      {a.rsvpOpen && a.rsvpDeadline && <p className="mt-2 text-xs text-slate-500">You can change your answer until {formatDateTime(a.rsvpDeadline, a.timezone)}.</p>}
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}

function ActivityCard({ a, eventTz }: { a: GuestActivity; eventTz: string }) {
  const location = a.venueAddress || a.venueName;
  return (
    <article id={`activity-${a.id}`} className="scroll-mt-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">{a.name}</h3>
          <p className="text-sm text-slate-600">
            {formatDateTime(a.startsAt, a.timezone)} – {timeOf(a.endsAt, a.timezone)}
            {a.timezone !== eventTz && <span className="text-slate-500"> ({timeZoneLabel(a.timezone)})</span>}
          </p>
        </div>
        <RsvpChip a={a} />
      </header>
      {a.description && <p className="mt-3 whitespace-pre-line text-slate-700">{a.description}</p>}

      {(location || a.virtualMeetingUrl) && (
        <div className="mt-4 space-y-2">
          {location && (
            <>
              <p className="text-sm text-slate-800">📍 {[a.venueName, a.venueAddress].filter(Boolean).join(', ')}</p>
              <MapPreview location={a.venueAddress ?? ''} venueName={a.venueName ?? undefined} height={180} />
            </>
          )}
          {a.virtualMeetingUrl && (
            <a href={a.virtualMeetingUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm font-semibold text-brand-700 hover:underline">
              💻 Join online ↗
            </a>
          )}
        </div>
      )}

      <RsvpPanel a={a} />
      {a.status !== 'CANCELLED' && (
        <a href={calendarUrl(a.id)} download className="mt-3 inline-block text-sm font-medium text-brand-700 hover:underline">
          📅 Add to calendar
        </a>
      )}

      <div className="mt-4 border-t border-slate-100 pt-4">
        <ActivityDetailsView activity={a} audience="guest" />
      </div>
    </article>
  );
}

function Banner({ view }: { view: GuestEventView }) {
  if (view.event.status === 'CANCELLED') return <Alert>This event has been cancelled by the organisers.</Alert>;
  if (view.event.status === 'COMPLETED') return <Alert tone="info">This event has ended — thank you for being part of it! This page stays available for you.</Alert>;
  return null;
}

/** /my-event — the guest's personalised event website (FR-094 – FR-108). */
export function GuestEventPage() {
  const { data: view, isPending, error } = useGuestView();

  if (isPending) return <GuestShell><Spinner label="Loading your event" /></GuestShell>;
  if (error) return <GuestShell><Alert>Could not load your event. Please try again in a moment.</Alert></GuestShell>;
  if (!view) {
    return (
      <GuestShell>
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <h1 className="text-xl font-bold">Open your invitation link</h1>
          <p className="mt-2 text-slate-600">To see your event, open the personal link from your invitation email on this device.</p>
        </div>
      </GuestShell>
    );
  }

  const e = view.event;
  if (view.availability === 'UPDATING') {
    return (
      <GuestShell name={view.guest.name}>
        <div className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <p className="text-4xl" aria-hidden>🛠️</p>
          <h1 className="mt-3 text-xl font-bold">{e.name}</h1>
          <p className="mt-2 text-slate-600">This event is being updated by the organisers. Please check back soon.</p>
        </div>
      </GuestShell>
    );
  }

  return (
    <GuestShell name={view.guest.name}>
      <div className="space-y-6">
        <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 p-6 text-white shadow-sm sm:p-8">
          <p className="text-sm font-medium text-brand-100">{e.eventTypeLabel} · You're invited, {view.guest.name.split(' ')[0]}</p>
          <h1 className="mt-1 text-3xl font-extrabold tracking-tight sm:text-4xl">{e.name}</h1>
          <p className="mt-2 text-brand-100">{formatDateRange(e.startsAt, e.endsAt, e.timezone)}</p>
          {e.description && <p className="mt-4 whitespace-pre-line text-white/90">{e.description}</p>}
        </section>

        <Banner view={view} />

        {view.activities.length === 0 ? (
          <Alert tone="info">The organisers haven't added you to any activities yet. Check back soon.</Alert>
        ) : (
          <>
            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-semibold">Your schedule</h2>
                <a href={calendarUrl()} download className="text-sm font-medium text-brand-700 hover:underline">
                  📅 Add all to calendar
                </a>
              </div>
              <Schedule items={view.itinerary} />
            </section>

            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Your activities</h2>
              {view.activities.map((a) => (
                <ActivityCard key={a.id} a={a} eventTz={e.timezone} />
              ))}
            </section>
          </>
        )}

        {(e.status === 'PUBLISHED' || e.status === 'COMPLETED') && <GuestPhotos activities={view.activities.map((a) => ({ id: a.id, name: a.name }))} />}

        {(e.instructions || e.organiserContact) && (
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {e.instructions && (
              <>
                <h2 className="text-lg font-semibold">Good to know</h2>
                <p className="mt-2 whitespace-pre-line text-slate-700">{e.instructions}</p>
              </>
            )}
            {e.organiserContact && (
              <div className={e.instructions ? 'mt-4 border-t border-slate-100 pt-4' : ''}>
                <h2 className="text-lg font-semibold">Questions? Contact the organisers</h2>
                <p className="mt-1 text-slate-700">
                  {e.organiserContact.name}
                  {e.organiserContact.email && (
                    <>
                      {' · '}
                      <a href={`mailto:${e.organiserContact.email}`} className="font-medium text-brand-700 hover:underline">
                        {e.organiserContact.email}
                      </a>
                    </>
                  )}
                  {e.organiserContact.phone && (
                    <>
                      {' · '}
                      <a href={`tel:${e.organiserContact.phone.replace(/[^+\d]/g, '')}`} className="font-medium text-brand-700 hover:underline">
                        {e.organiserContact.phone}
                      </a>
                    </>
                  )}
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </GuestShell>
  );
}
