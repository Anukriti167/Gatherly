import { useState } from 'react';
import type { EventSummary, Timeframe } from '@gatherly/shared';
import { Link, useNavigate } from 'react-router';
import { Alert, Badge, Button, Card, Spinner } from '../components/ui';
import { useCurrentUser } from '../features/auth/use-auth';
import { useEvents } from '../features/events/use-events';
import { ActionItemsPanel } from '../features/notifications/ActionItemsPanel';
import { InvitationsPanel } from '../features/organisers/InvitationsPanel';
import { api, ApiError } from '../lib/api';
import { useOpenAsGuest } from '../features/guest-site/use-guest';
import { eventTypeLabel, formatDateRange, STATUS_LABEL, STATUS_TONE } from '../lib/format';

const EMPTY_HINT: Record<Timeframe, string> = {
  upcoming: 'Create your first event to get started.',
  ongoing: 'Events show here while they are happening.',
  completed: 'Finished events are kept here as your event history.',
  cancelled: 'Events cancelled with every organiser’s approval are kept here.',
};

const TABS: { key: Timeframe; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

function VerifyEmailBanner() {
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  if (sent) return <Alert tone="success">Confirmation email sent — check your inbox.</Alert>;
  return (
    <Alert tone="info">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span>Please confirm your email address so we can show events you're invited to.</span>
        <Button
          variant="secondary"
          loading={sending}
          onClick={async () => {
            setSending(true);
            try {
              await api.post('/auth/resend-verification');
              setSent(true);
            } finally {
              setSending(false);
            }
          }}
        >
          Resend email
        </Button>
      </div>
    </Alert>
  );
}

const CARD = 'group block w-full rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-200 transition hover:shadow-md hover:ring-brand-200';

function CardBody({ event }: { event: EventSummary }) {
  const role = event.role === 'OWNER' ? 'Owner' : event.role === 'CO_ADMIN' ? 'Co-admin' : null;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-slate-900 group-hover:text-brand-700">{event.name}</h3>
        <Badge tone={STATUS_TONE[event.status]}>{STATUS_LABEL[event.status]}</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-600">{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</p>
      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <span>{eventTypeLabel(event.eventType, event.customTypeLabel)}</span>
        <span aria-hidden>·</span>
        {role ? <span>{role}</span> : <span className="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-700">✉ Invited</span>}
      </div>
    </>
  );
}

/** Organisers open the event page; invited guests open their personal guest page (FR-006). */
function EventCard({ event }: { event: EventSummary }) {
  const openAsGuest = useOpenAsGuest();
  const navigate = useNavigate();
  if (event.role !== 'GUEST') {
    return (
      <Link to={`/events/${event.id}`} className={CARD}>
        <CardBody event={event} />
      </Link>
    );
  }
  return (
    <button
      type="button"
      className={CARD}
      aria-busy={openAsGuest.isPending || undefined}
      onClick={() => openAsGuest.mutate(event.id, { onSuccess: () => navigate('/my-event') })}
    >
      <CardBody event={event} />
      {openAsGuest.error && <p className="mt-2 text-xs text-red-600">{openAsGuest.error instanceof ApiError ? openAsGuest.error.message : 'Could not open the invitation.'}</p>}
    </button>
  );
}

/** FR-006, FR-007 — events the user owns or co-hosts, grouped by timeframe. */
export function DashboardPage() {
  const { data: user } = useCurrentUser();
  const { data: events, isPending, error } = useEvents();
  const [tab, setTab] = useState<Timeframe>('upcoming');
  if (!user) return null;

  const counts = Object.fromEntries(TABS.map((t) => [t.key, events?.filter((e) => e.timeframe === t.key).length ?? 0]));
  const visible = events?.filter((e) => e.timeframe === tab) ?? [];

  return (
    <div className="space-y-6">
      {!user.emailVerified && <VerifyEmailBanner />}
      <ActionItemsPanel />
      <InvitationsPanel />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Hi, {user.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-slate-600">Events you organise, and events you’re invited to as a guest.</p>
        </div>
        <Link to="/events/new" className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
          + Create event
        </Link>
      </div>

      <div role="tablist" aria-label="Event timeframe" className="inline-flex max-w-full overflow-x-auto rounded-lg bg-slate-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium ${tab === t.key ? 'bg-white shadow-sm' : 'text-slate-600'}`}
          >
            {t.label}
            {counts[t.key] ? <span className="ml-1.5 text-xs text-slate-500">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      {isPending ? (
        <Spinner label="Loading events" />
      ) : error ? (
        <Alert>Could not load your events. {error.message}</Alert>
      ) : visible.length === 0 ? (
        <Card className="py-14 text-center">
          <p className="text-base font-semibold">No {tab} events</p>
          <p className="mt-1 text-sm text-slate-600">
            {EMPTY_HINT[tab]}
          </p>
          {tab === 'upcoming' && (
            <Link to="/events/new" className="mt-5 inline-block font-semibold text-brand-700 hover:underline">
              Create an event →
            </Link>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      )}
    </div>
  );
}
