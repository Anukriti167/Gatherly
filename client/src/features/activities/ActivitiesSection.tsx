import { useState } from 'react';
import type { ActivityDetail, EventDetail } from '@gatherly/shared';
import { Alert, Badge, Button, Card, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDateTime, timeZoneLabel } from '../../lib/format';
import { ActivityDetailsView } from './ActivityDetailsView';
import { ActivityForm, activityToFormValues, emptyActivity, type LocationSource } from './ActivityForm';
import { useActivities, useCreateActivity, useDeleteActivity, useUpdateActivity } from './use-activities';

/** Adds hours to a wall-clock "YYYY-MM-DDTHH:mm" string (timezone-free arithmetic). */
function addHours(local: string, hours: number): string {
  const d = new Date(`${local}:00Z`);
  d.setUTCHours(d.getUTCHours() + hours);
  return d.toISOString().slice(0, 16);
}

function ActivityCard({
  activity,
  eventTimezone,
  canEdit,
  onEdit,
  onDelete,
  deleting,
}: {
  activity: ActivityDetail;
  eventTimezone: string;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [open, setOpen] = useState(false);
  const otherZone = activity.timezone !== eventTimezone;
  const summary = detailsSummary(activity);

  return (
    <li className="rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{activity.name}</h3>
            {activity.status !== 'SCHEDULED' && <Badge tone={activity.status === 'CANCELLED' ? 'red' : 'brand'}>{activity.status.toLowerCase()}</Badge>}
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {formatDateTime(activity.startsAt, activity.timezone)} – {formatDateTime(activity.endsAt, activity.timezone)}
            {otherZone && <span className="ml-1 text-slate-500">({timeZoneLabel(activity.timezone)})</span>}
          </p>
        </div>
        {canEdit && (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
            {confirming ? (
              <>
                <Button variant="danger" loading={deleting} onClick={onDelete}>
                  Confirm remove
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${activity.name}`}>
                Remove
              </Button>
            )}
          </div>
        )}
      </div>

      <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        {(activity.venueName || activity.venueAddress) && (
          <div>
            <dt className="sr-only">Venue</dt>
            <dd className="text-slate-700">
              📍 {[activity.venueName, activity.venueAddress].filter(Boolean).join(', ')}
              {activity.mapsUrl && (
                <a href={activity.mapsUrl} target="_blank" rel="noopener noreferrer" className="ml-2 font-medium text-brand-700 hover:underline">
                  Directions ↗
                </a>
              )}
            </dd>
          </div>
        )}
        {activity.virtualMeetingUrl && (
          <div>
            <dt className="sr-only">Online link</dt>
            <dd>
              💻{' '}
              <a href={activity.virtualMeetingUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 hover:underline">
                Join online ↗
              </a>
            </dd>
          </div>
        )}
        {activity.capacity && (
          <div>
            <dt className="sr-only">Capacity</dt>
            <dd className="text-slate-700">👥 Up to {activity.capacity} guests</dd>
          </div>
        )}
        {activity.rsvpDeadline && (
          <div>
            <dt className="sr-only">RSVP deadline</dt>
            <dd className="text-slate-700">⏰ RSVP by {formatDateTime(activity.rsvpDeadline, activity.timezone)}</dd>
          </div>
        )}
      </dl>

      {summary && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex w-full items-center justify-between text-left text-sm font-medium text-brand-700 hover:underline"
          >
            <span>
              {open ? 'Hide details' : 'Show details'} <span className="font-normal text-slate-500">· {summary}</span>
            </span>
            <span aria-hidden>{open ? '▴' : '▾'}</span>
          </button>
          {open && (
            <div className="mt-4">
              <ActivityDetailsView activity={activity} audience="organiser" />
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/** "5 itinerary entries · 12 dishes · 2 performers · dress code" */
function detailsSummary(a: ActivityDetail): string {
  const dishes = a.menu.reduce((n, c) => n + c.items.length, 0);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return [
    a.itinerary.length && count(a.itinerary.length, 'itinerary entry', 'itinerary entries'),
    dishes && count(dishes, 'dish', 'dishes'),
    a.people.length && count(a.people.length, 'person', 'people'),
    (a.dressCode || a.themeDescription || a.themeColors.length) && 'dress code & theme',
    a.instructions && 'instructions',
  ]
    .filter(Boolean)
    .join(' · ');
}

const hasLocation = (a: ActivityDetail) => Boolean(a.venueName || a.venueAddress);

/** Other activities' distinct locations, offered as "copy location from…". */
function locationSources(activities: ActivityDetail[], excludeId?: string): LocationSource[] {
  const seen = new Set<string>();
  const out: LocationSource[] = [];
  for (const a of activities) {
    if (a.id === excludeId || !hasLocation(a)) continue;
    const key = `${a.venueName ?? ''}|${a.venueAddress ?? ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: a.id, name: a.name, venueName: a.venueName, venueAddress: a.venueAddress });
  }
  return out;
}

/** FR-012, FR-013, FR-019 – FR-036 — the activities of an event, managed by its organisers. */
export function ActivitiesSection({ event }: { event: EventDetail }) {
  const { data: activities, isPending, error } = useActivities(event.id);
  const create = useCreateActivity(event.id);
  const update = useUpdateActivity(event.id);
  const remove = useDeleteActivity(event.id);
  const [mode, setMode] = useState<{ kind: 'list' } | { kind: 'add'; fromVersion: number } | { kind: 'edit'; activity: ActivityDetail; fromVersion: number }>({ kind: 'list' });
  const [actionError, setActionError] = useState<string | null>(null);
  const canEdit = event.allowedActions.includes('event.edit');

  if (mode.kind !== 'list') {
    const editing = mode.kind === 'edit' ? mode.activity : null;
    const sources = locationSources(activities ?? [], editing?.id);

    let initial = editing ? activityToFormValues(editing) : emptyActivity(event.timezone, event.startsAtLocal, addHours(event.startsAtLocal, 2));
    if (!editing) {
      // New activities start with the location of the most recently added activity.
      const previous = [...(activities ?? [])].filter(hasLocation).sort((a, b) => b.sortOrder - a.sortOrder)[0];
      if (previous) initial = { ...initial, venueName: previous.venueName ?? '', venueAddress: previous.venueAddress ?? '' };
    }

    return (
      <Card>
        <h2 className="mb-5 text-lg font-semibold">{editing ? `Edit “${editing.name}”` : 'Add an activity'}</h2>
        <ActivityForm
          initial={initial}
          locationSources={sources}
          submitLabel={editing ? 'Save activity' : 'Add activity'}
          onCancel={() => setMode({ kind: 'list' })}
          onSubmit={async (values) => {
            // Use the version the form was opened from, so a concurrent edit is detected rather than overwritten.
            if (editing) await update.mutateAsync({ id: editing.id, changes: values, expectedVersion: mode.fromVersion });
            else await create.mutateAsync({ activity: values, expectedVersion: mode.fromVersion });
            setMode({ kind: 'list' });
          }}
        />
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Activities</h2>
          <p className="text-sm text-slate-500">Each activity has its own time, place and details. Guests only see the ones they're invited to.</p>
        </div>
        {canEdit && <Button onClick={() => setMode({ kind: 'add', fromVersion: event.version })}>+ Add activity</Button>}
      </div>

      {actionError && (
        <div className="mt-4">
          <Alert>{actionError}</Alert>
        </div>
      )}

      {isPending ? (
        <Spinner label="Loading activities" />
      ) : error ? (
        <div className="mt-4">
          <Alert>Could not load activities. {error.message}</Alert>
        </div>
      ) : activities.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No activities yet.{canEdit && ' Add the first one — e.g. a ceremony, a session or a dinner.'}
        </p>
      ) : (
        <ol className="mt-5 space-y-3">
          {activities.map((a) => (
            <ActivityCard
              key={a.id}
              activity={a}
              eventTimezone={event.timezone}
              canEdit={canEdit}
              deleting={remove.isPending && remove.variables?.id === a.id}
              onEdit={() => setMode({ kind: 'edit', activity: a, fromVersion: event.version })}
              onDelete={() => {
                setActionError(null);
                remove.mutate(
                  { id: a.id, expectedVersion: event.version },
                  { onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Could not remove the activity.') },
                );
              }}
            />
          ))}
        </ol>
      )}
    </Card>
  );
}
