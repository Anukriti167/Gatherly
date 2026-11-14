import { useState } from 'react';
import { changePasswordSchema, PASSWORD_MIN_LENGTH, updateProfileSchema } from '@gatherly/shared';
import { Alert, Button, Card, TextField } from '../components/ui';
import { useCurrentUser, useUpdateProfile } from '../features/auth/use-auth';
import { api } from '../lib/api';
import { useForm } from '../lib/use-form';

function ProfileForm({ name, phone }: { name: string; phone: string }) {
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const form = useForm(updateProfileSchema, { name, phone });

  const onSubmit = form.handleSubmit(async (data) => {
    setSaved(false);
    await update.mutateAsync(data);
    setSaved(true);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {form.formError && <Alert>{form.formError}</Alert>}
      {saved && <Alert tone="success">Profile saved.</Alert>}
      <TextField label="Full name" autoComplete="name" {...form.field('name')} />
      <TextField
        label="Phone number (optional)"
        type="tel"
        autoComplete="tel"
        hint="Leave blank to remove it. Only you can see this."
        {...form.field('phone')}
      />
      <Button type="submit" loading={form.submitting}>
        Save profile
      </Button>
    </form>
  );
}

function ChangePasswordForm() {
  const [done, setDone] = useState(false);
  const form = useForm(changePasswordSchema, { currentPassword: '', newPassword: '' });

  const onSubmit = form.handleSubmit(async (data) => {
    setDone(false);
    await api.post('/auth/change-password', data);
    form.setValues({ currentPassword: '', newPassword: '' });
    setDone(true);
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {form.formError && <Alert>{form.formError}</Alert>}
      {done && <Alert tone="success">Password changed. Other devices have been signed out.</Alert>}
      <TextField label="Current password" type="password" autoComplete="current-password" {...form.field('currentPassword')} />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`}
        {...form.field('newPassword')}
      />
      <Button type="submit" loading={form.submitting}>
        Change password
      </Button>
    </form>
  );
}

/** FR-004, FR-005 */
export function ProfilePage() {
  const { data: user } = useCurrentUser();
  if (!user) return null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Your profile</h1>
      <Card>
        <h2 className="text-lg font-semibold">Details</h2>
        <p className="mb-5 mt-1 text-sm text-slate-600">
          Signed in as <span className="font-medium text-slate-800">{user.email}</span>
          {user.emailVerified ? ' · verified' : ' · not yet verified'}
        </p>
        <ProfileForm name={user.name} phone={user.phone ?? ''} />
      </Card>
      <Card>
        <h2 className="mb-5 text-lg font-semibold">Password</h2>
        <ChangePasswordForm />
      </Card>
    </div>
  );
}
