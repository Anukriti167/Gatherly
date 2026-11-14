import { createGuestSchema, type ActivityDetail, type CreateGuestInput } from '@gatherly/shared';
import { Alert, Button, TextField } from '../../components/ui';
import { useForm } from '../../lib/use-form';
import { AssignmentPicker } from './AssignmentPicker';

export type GuestFormValues = { name: string; email: string; phone: string; allActivities: boolean; activityIds: string[] };

/** Add / edit one guest (FR-068, FR-073, FR-075, FR-076 – FR-078). */
export function GuestForm({
  initial,
  activities,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: GuestFormValues;
  activities: ActivityDetail[];
  submitLabel: string;
  onSubmit: (v: CreateGuestInput) => Promise<void>;
  onCancel: () => void;
}) {
  const form = useForm(createGuestSchema, initial);
  const v = form.values as GuestFormValues;

  return (
    <form onSubmit={form.handleSubmit(async () => onSubmit(v))} noValidate className="space-y-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
      {form.formError && <Alert>{form.formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Name" autoComplete="off" {...form.field('name')} />
        <TextField label="Email" type="email" autoComplete="off" {...form.field('email')} />
        <TextField label="Phone (optional)" type="tel" autoComplete="off" hint="Only organisers can see this." {...form.field('phone')} />
      </div>
      <AssignmentPicker
        activities={activities}
        allActivities={v.allActivities}
        activityIds={v.activityIds}
        error={form.errors['activityIds']}
        onChange={(a) => form.setValues((prev) => ({ ...prev, ...a }))}
      />
      <div className="flex gap-2">
        <Button type="submit" loading={form.submitting}>
          {submitLabel}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
