import { useState } from 'react';
import { editModeFor, type EventDetail } from '@gatherly/shared';
import { Link, useParams } from 'react-router';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';
import { ActivitiesSection } from '../../features/activities/ActivitiesSection';
import { GuestsSection } from '../../features/guests/GuestsSection';
import { EventTabs, NeedsYouStrip, useEventTab } from '../../features/events/EventTabs';
import { EventHistoryTab } from '../../features/history/EventHistorySection';
import { OrganisersSection } from '../../features/organisers/OrganisersSection';
import { ProposalsSection } from '../../features/proposals/ProposalsSection';
import { PublicationCard } from '../../features/publication/PublicationCard';
import { EventDetailsForm } from '../../features/events/EventDetailsForm';
import { useEvent, useUpdateEvent } from '../../features/events/use-events';
import { ApiError } from '../../lib/api';
import { eventTypeLabel, formatDateTime, STATUS_LABEL, STATUS_TONE, timeZoneLabel } from '../../lib/format';
import { useScrollToHash } from '../../lib/use-scroll-to-hash';

function EditNotice({ event }: { event: EventDetail }) {
  const mode = editModeFor(event.status);
  if (mode === 'direct-invalidates-approvals')
    return <Alert tone="info">This event is awaiting approval. Editing it will reset all approvals and start a new round.</Alert>;
  if (mode === 'proposal')
    return (
      <Alert tone="info">
        This event is published. Guests can still be added and edited directly. Removing guests, unpublishing and cancelling need every
        organiser's approval through a change proposal. Proposing changes to details and activities is coming next — until then they're locked.
      </Alert>
    );
  if (mode === 'locked') return <Alert tone="info">This event is {STATUS_LABEL[event.status].toLowerCase()} and can no longer be edited.</Alert>;
  return null;
}

function Overview({ event, onEdit }: { event: EventDetail; onEdit?: () => void }) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <dl className="grid flex-1 gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="font-medium text-slate-500">Starts</dt>
            <dd className="mt-0.5 text-slate-900">{formatDateTime(event.startsAt, event.timezone)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Ends</dt>
            <dd className="mt-0.5 text-slate-900">{formatDateTime(event.endsAt, event.timezone)}</dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Timezone</dt>
            <dd className="mt-0.5 text-slate-900">
              {event.timezone.replaceAll('_', ' ')} ({timeZoneLabel(event.timezone)})
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-500">Planning style</dt>
            <dd className="mt-0.5 text-slate-900">
              {event.planningPath === 'FORMAL' ? 'Formal' : event.planningPath === 'INFORMAL' ? 'Informal' : 'Not set'}
            </dd>
          </div>
        </dl>
        {onEdit && (
          <Button variant="secondary" onClick={onEdit}>
            Edit details
          </Button>
        )}
      </div>
      <div className="mt-6 border-t border-slate-100 pt-5">
        <h2 className="text-sm font-medium text-slate-500">Description</h2>
        <p className="mt-1 whitespace-pre-line text-slate-800">{event.description || <span className="italic text-slate-400">No description yet.</span>}</p>
      </div>
    </Card>
  );
}

export function EventPage() {
  const { eventId = '' } = useParams();
  const { data: event, isPending, error } = useEvent(eventId);
  const [tab, setTab] = useEventTab();
  useScrollToHash(); // notification links like #proposal-… scroll to the item inside its tab
  const update = useUpdateEvent(eventId);
  // Version the editor started from (null = not editing) — not the live, auto-refreshed one.
  const [editingFrom, setEditingFrom] = useState<number | null>(null);
  const editing = editingFrom !== null;

  if (isPending) return <Spinner label="Loading event" />;
  if (error || !event) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-xl font-bold">{notFound ? 'Event not found' : 'Could not load this event'}</h1>
        <p className="mt-2 text-slate-600">{notFound ? "It doesn't exist or you don't have access to it." : error?.message}</p>
        <Link to="/dashboard" className="mt-6 inline-block font-semibold text-brand-700 hover:underline">
          Back to dashboard
        </Link>
      </div>
    );
  }

  const canEdit = event.allowedActions.includes('event.edit');

  return (
    <div className="space-y-5">
      <div>
        <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
          ← Back to dashboard
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{event.name}</h1>
          <Badge tone={STATUS_TONE[event.status]}>{STATUS_LABEL[event.status]}</Badge>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {eventTypeLabel(event.eventType, event.customTypeLabel)} · You are the {event.role === 'OWNER' ? 'owner' : 'co-admin'} · Version{' '}
          {event.version}
        </p>
      </div>

      {/* Always visible: anything waiting on you, whichever tab is open. */}
      <NeedsYouStrip event={event} onOpen={setTab} />

      <EventTabs event={event} active={tab} onChange={setTab} />

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-6">
        {tab === 'overview' && (
          <>
            <EditNotice event={event} />
            <PublicationCard event={event} />
            {editing ? (
              <Card>
                <h2 className="mb-5 text-lg font-semibold">Edit details</h2>
                <EventDetailsForm
                  initial={{
                    name: event.name,
                    description: event.description,
                    eventType: event.eventType,
                    customTypeLabel: event.customTypeLabel ?? '',
                    planningPath: event.planningPath ?? '',
                    timezone: event.timezone,
                    startsAt: event.startsAtLocal,
                    endsAt: event.endsAtLocal,
                  }}
                  submitLabel="Save changes"
                  onSubmit={async (changes) => {
                    await update.mutateAsync({ changes, expectedVersion: editingFrom ?? event.version });
                    setEditingFrom(null);
                  }}
                  onCancel={() => setEditingFrom(null)}
                />
              </Card>
            ) : (
              <Overview event={event} onEdit={canEdit ? () => setEditingFrom(event.version) : undefined} />
            )}
          </>
        )}
        {tab === 'activities' && <ActivitiesSection event={event} />}
        {tab === 'guests' && <GuestsSection event={event} />}
        {tab === 'organisers' && <OrganisersSection event={event} />}
        {tab === 'proposals' && <ProposalsSection event={event} />}
        {tab === 'history' && <EventHistoryTab event={event} />}
      </div>
    </div>
  );
}
