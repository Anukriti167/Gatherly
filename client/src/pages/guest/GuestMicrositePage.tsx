import type { GuestActivity, GuestEventView } from '@gatherly/shared';
import { Link, useParams } from 'react-router';
import { Alert, Spinner } from '../../components/ui';
import { MapPreview } from '../../components/MapPreview';
import { ActivityDetailsView } from '../../features/activities/ActivityDetailsView';
import { GuestPhotos } from '../../features/photos/GuestPhotos';
import { calendarUrl, useGuestLogout, useGuestMicrositeActivity, useGuestMicrositeEvent, useRsvp } from '../../features/guest-site/use-guest';
import { ApiError } from '../../lib/api';
import { formatDateRange, formatDateTime, timeZoneLabel } from '../../lib/format';

function GuestMicrositeShell({ name, children }: { name?: string; children: React.ReactNode }) {
  const logout = useGuestLogout();
  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-bold text-slate-900">
            <img src="/favicon.svg" alt="" className="size-6" /> Gatherly
          </Link>
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
      <main className="mx-auto max-w-3xl px-4 py-6 sm:py-10">{children}</main>
    </div>
  );
}

function EventStatus({ view }: { view: GuestEventView }) {
  if (view.event.status === 'CANCELLED') return <Alert>This event has been cancelled by the organisers.</Alert>;
  if (view.event.status === 'COMPLETED') return <Alert tone="info">This event has ended. This page will remain available to you.</Alert>;
  return null;
}

function EventMicrosite() {
  const { eventSlug = '' } = useParams();
  const { data: view, isPending, error } = useGuestMicrositeEvent(eventSlug);

  if (isPending) return <GuestMicrositeShell><Spinner label="Loading event website" /></GuestMicrositeShell>;
  if (error || !view) {
    return <GuestMicrositeShell><Alert>{error ? 'This event website could not be loaded. Please check your invitation link.' : 'Open your personal invitation link on this device to view the event.'}</Alert></GuestMicrositeShell>;
  }
  if (view.availability === 'UPDATING') {
    return (
      <GuestMicrositeShell name={view.guest.name}>
        <section className="rounded-2xl bg-white p-8 text-center ring-1 ring-slate-200">
          <h1 className="text-2xl font-bold">{view.event.name}</h1>
          <p className="mt-2 text-slate-600">The organisers are updating this event. Please check back soon.</p>
        </section>
      </GuestMicrositeShell>
    );
  }

  const e = view.event;
  return (
    <GuestMicrositeShell name={view.guest.name}>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 p-6 text-white shadow-sm sm:p-9">
          <p className="text-sm font-medium text-brand-100">{e.eventTypeLabel} · Welcome, {view.guest.name.split(' ')[0]}</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl">{e.name}</h1>
          <p className="mt-3 text-brand-100">{formatDateRange(e.startsAt, e.endsAt, e.timezone)}</p>
          {e.description && <p className="mt-5 whitespace-pre-line leading-relaxed text-white/90">{e.description}</p>}
        </section>

        <EventStatus view={view} />

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <h2 className="text-lg font-semibold text-slate-900">Your activities</h2>
          {view.activities.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">You don't have any activities assigned yet. Please check back with the organisers.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {view.activities.map((activity) => (
                <Link
                  key={activity.id}
                  to={`/e/${encodeURIComponent(eventSlug)}/a/${encodeURIComponent(activity.slug!)}`}
                  className="block rounded-xl border border-slate-200 p-4 transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-slate-900">{activity.name}</h3>
                      <p className="mt-1 text-sm text-slate-600">{formatDateTime(activity.startsAt, activity.timezone)}</p>
                    </div>
                    <span className="text-sm font-semibold text-brand-700">View details →</span>
                  </div>
                  {activity.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{activity.description}</p>}
                </Link>
              ))}
            </div>
          )}
        </section>

        {(e.instructions || e.organiserContact) && (
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {e.instructions && <><h2 className="font-semibold">Good to know</h2><p className="mt-2 whitespace-pre-line text-sm text-slate-700">{e.instructions}</p></>}
            {e.organiserContact && (
              <div className={e.instructions ? 'mt-4 border-t border-slate-100 pt-4' : ''}>
                <h2 className="font-semibold">Contact the organisers</h2>
                <p className="mt-2 text-sm text-slate-700">
                  {e.organiserContact.name}
                  {e.organiserContact.email && <> · <a className="text-brand-700 hover:underline" href={`mailto:${e.organiserContact.email}`}>{e.organiserContact.email}</a></>}
                  {e.organiserContact.phone && <> · <a className="text-brand-700 hover:underline" href={`tel:${e.organiserContact.phone.replace(/[^+\d]/g, '')}`}>{e.organiserContact.phone}</a></>}
                </p>
              </div>
            )}
          </section>
        )}

        {(e.status === 'PUBLISHED' || e.status === 'COMPLETED') && (
          <GuestPhotos activities={view.activities.map((a) => ({ id: a.id, name: a.name }))} />
        )}
      </div>
    </GuestMicrositeShell>
  );
}

function ActivityRsvp({ activity }: { activity: GuestActivity }) {
  const mutation = useRsvp();
  const busy = mutation.isPending && mutation.variables?.activityId === activity.id;
  const error = mutation.error && mutation.variables?.activityId === activity.id
    ? mutation.error instanceof ApiError ? mutation.error.message : 'Could not save your response.'
    : null;
  if (activity.status === 'CANCELLED') return null;

  const buttonClass = (selected: boolean, positive: boolean) =>
    `flex-1 rounded-xl px-4 py-3 text-sm font-semibold ring-1 disabled:cursor-not-allowed disabled:opacity-50 ${
      selected
        ? positive ? 'bg-emerald-600 text-white ring-emerald-600' : 'bg-slate-700 text-white ring-slate-700'
        : 'bg-white text-slate-800 ring-slate-300 hover:bg-slate-50'
    }`;

  return (
    <section className="mt-5 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      <p className="text-sm font-semibold text-slate-800">Will you be there?</p>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={!activity.rsvpOpen || busy || (activity.full && activity.rsvp !== 'CONFIRMED')} aria-pressed={activity.rsvp === 'CONFIRMED'} className={buttonClass(activity.rsvp === 'CONFIRMED', true)} onClick={() => mutation.mutate({ activityId: activity.id, status: 'CONFIRMED' })}>I'll be there</button>
        <button type="button" disabled={!activity.rsvpOpen || busy} aria-pressed={activity.rsvp === 'DECLINED'} className={buttonClass(activity.rsvp === 'DECLINED', false)} onClick={() => mutation.mutate({ activityId: activity.id, status: 'DECLINED' })}>Can't make it</button>
      </div>
      {!activity.rsvpOpen && <p className="mt-2 text-xs text-slate-500">RSVP responses are closed for this activity.</p>}
      {activity.full && activity.rsvp !== 'CONFIRMED' && activity.rsvpOpen && <p className="mt-2 text-xs text-amber-700">This activity is full. Contact the organisers if you'd like to attend.</p>}
      {activity.rsvpOpen && activity.rsvpDeadline && <p className="mt-2 text-xs text-slate-500">You can change your answer until {formatDateTime(activity.rsvpDeadline, activity.timezone)}.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </section>
  );
}

function ActivityMicrosite() {
  const { eventSlug = '', activitySlug = '' } = useParams();
  const { data, isPending, error } = useGuestMicrositeActivity(eventSlug, activitySlug);

  if (isPending) return <GuestMicrositeShell><Spinner label="Loading activity" /></GuestMicrositeShell>;
  if (error || !data) {
    return <GuestMicrositeShell><Alert>{error ? 'This activity is unavailable or you do not have access to it.' : 'Open your personal invitation link on this device to view this activity.'}</Alert></GuestMicrositeShell>;
  }

  const { view, activity } = data;
  const location = activity.venueAddress || activity.venueName;
  return (
    <GuestMicrositeShell name={view.guest.name}>
      <div className="space-y-5">
        <Link to={`/e/${encodeURIComponent(eventSlug)}`} className="inline-flex text-sm font-semibold text-brand-700 hover:underline">← Back to event</Link>
        {view.availability === 'UPDATING' ? (
          <Alert>The organisers are updating this event. Please check back soon.</Alert>
        ) : (
          <>
            <section className="rounded-2xl bg-gradient-to-br from-brand-600 to-brand-900 p-6 text-white shadow-sm sm:p-8">
              <p className="text-sm text-brand-100">{view.event.name}</p>
              <h1 className="mt-2 text-3xl font-extrabold">{activity.name}</h1>
              <p className="mt-3 text-brand-100">{formatDateTime(activity.startsAt, activity.timezone)}{activity.endsAt ? ` – ${formatDateTime(activity.endsAt, activity.timezone)}` : ''}</p>
              {activity.timezone !== view.event.timezone && <p className="mt-1 text-sm text-brand-100">{timeZoneLabel(activity.timezone)}</p>}
              {activity.description && <p className="mt-4 whitespace-pre-line text-white/90">{activity.description}</p>}
            </section>

            {activity.status === 'CANCELLED' && <Alert>This activity has been cancelled by the organisers.</Alert>}

            {(location || activity.virtualMeetingUrl) && (
              <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
                <h2 className="font-semibold">Location</h2>
                {location && <><p className="mt-2 text-sm text-slate-700">{[activity.venueName, activity.venueAddress].filter(Boolean).join(', ')}</p><MapPreview location={activity.venueAddress ?? ''} venueName={activity.venueName ?? undefined} height={190} /></>}
                {activity.virtualMeetingUrl && <a href={activity.virtualMeetingUrl} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm font-semibold text-brand-700 hover:underline">Join online ↗</a>}
              </section>
            )}

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <ActivityDetailsView activity={activity} audience="guest" />
              <ActivityRsvp activity={activity} />
              {activity.status !== 'CANCELLED' && <a href={calendarUrl(activity.id)} download className="mt-4 inline-block text-sm font-semibold text-brand-700 hover:underline">Add to calendar</a>}
            </section>
            {(view.event.status === 'PUBLISHED' || view.event.status === 'COMPLETED') && (
              <GuestPhotos activities={[{ id: activity.id, name: activity.name }]} />
            )}
          </>
        )}
      </div>
    </GuestMicrositeShell>
  );
}

export function GuestEventMicrositePage() {
  return <EventMicrosite />;
}

export function GuestActivityMicrositePage() {
  return <ActivityMicrosite />;
}
