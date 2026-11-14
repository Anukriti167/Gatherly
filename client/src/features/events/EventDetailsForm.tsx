import { useMemo } from 'react';
import { createEventSchema, EVENT_TYPE_LABELS, EVENT_TYPES, type CreateEventInput } from '@gatherly/shared';
import { Alert, Button, SelectField, TextAreaField, TextField } from '../../components/ui';
import { timeZoneOptions } from '../../lib/format';
import { useForm } from '../../lib/use-form';

export type EventFormValues = {
  name: string;
  description: string;
  eventType: CreateEventInput['eventType'];
  customTypeLabel: string;
  planningPath: '' | 'FORMAL' | 'INFORMAL';
  timezone: string;
  startsAt: string;
  endsAt: string;
};

const typeOptions = EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABELS[t] }));
const pathOptions = [
  { value: '', label: 'Skip — start from scratch' },
  { value: 'FORMAL', label: 'Formal (ceremonies, conferences, summits)' },
  { value: 'INFORMAL', label: 'Informal (parties, get-togethers, meetups)' },
];

/** Event name, type, planning path, timezone, dates and description (FR-009, FR-010, FR-047). */
export function EventDetailsForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: EventFormValues;
  submitLabel: string;
  onSubmit: (values: CreateEventInput) => Promise<void>;
  onCancel?: () => void;
}) {
  const form = useForm(createEventSchema, initial);
  const zones = useMemo(() => {
    const opts = timeZoneOptions();
    // Keep the event's saved zone selectable even if this browser doesn't list it.
    return opts.some((o) => o.value === initial.timezone) ? opts : [{ value: initial.timezone, label: initial.timezone }, ...opts];
  }, [initial.timezone]);

  const submit = form.handleSubmit(async (data) => onSubmit(data as CreateEventInput));

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {form.formError && <Alert>{form.formError}</Alert>}
      <TextField label="Event name" required placeholder="e.g. Asha & Rohan's Wedding" {...form.field('name')} />

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField label="Event type" options={typeOptions} {...form.field('eventType')} hint="Only used for suggestions — every feature works for every type." />
        {form.values.eventType === 'OTHER' ? (
          <TextField label="Describe the occasion" placeholder="e.g. Housewarming" {...form.field('customTypeLabel')} />
        ) : (
          <SelectField label="Planning style (optional)" options={pathOptions} {...form.field('planningPath')} />
        )}
      </div>

      <SelectField label="Timezone" options={zones} {...form.field('timezone')} hint="Times below are in this timezone. Guests see them in it too." />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField label="Starts" type="datetime-local" required {...form.field('startsAt')} />
        <TextField label="Ends" type="datetime-local" required {...form.field('endsAt')} />
      </div>

      <TextAreaField label="Description" rows={5} placeholder="What should guests know about this event?" {...form.field('description')} />

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={form.submitting}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
