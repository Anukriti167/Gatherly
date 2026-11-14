import { Link, useNavigate } from 'react-router';
import { Card } from '../../components/ui';
import { EventDetailsForm, type EventFormValues } from '../../features/events/EventDetailsForm';
import { useCreateEvent } from '../../features/events/use-events';
import { browserTimeZone } from '../../lib/format';

function defaultTimes(): { startsAt: string; endsAt: string } {
  // Next Saturday, 6 pm – 10 pm, as a friendly starting point.
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { startsAt: `${day}T18:00`, endsAt: `${day}T22:00` };
}

/** FR-008, FR-014 — new events are saved as Drafts. */
export function CreateEventPage() {
  const create = useCreateEvent();
  const navigate = useNavigate();

  const initial: EventFormValues = {
    name: '',
    description: '',
    eventType: 'WEDDING',
    customTypeLabel: '',
    planningPath: '',
    timezone: browserTimeZone(),
    ...defaultTimes(),
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
          ← Back to dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Create an event</h1>
        <p className="mt-1 text-sm text-slate-600">
          It's saved as a draft — only you and your co-organisers can see it until it's published.
        </p>
      </div>
      <Card>
        <EventDetailsForm
          initial={initial}
          submitLabel="Create draft"
          onSubmit={async (values) => {
            const event = await create.mutateAsync(values);
            navigate(`/events/${event.id}`);
          }}
          onCancel={() => navigate('/dashboard')}
        />
      </Card>
    </div>
  );
}
