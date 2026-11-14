import { useEffect, useState } from 'react';
import { PASSWORD_MIN_LENGTH, resetPasswordSchema } from '@gatherly/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AuthCard } from '../../components/layouts';
import { Alert, Button, TextField } from '../../components/ui';
import { currentUserKey } from '../../features/auth/use-auth';
import { api } from '../../lib/api';
import { useForm } from '../../lib/use-form';

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  // Read the token once, then strip it from the address bar so it isn't left in history.
  const [token] = useState(() => params.get('token') ?? '');
  useEffect(() => {
    if (params.has('token')) window.history.replaceState(null, '', '/reset-password');
  }, [params]);
  const [done, setDone] = useState(false);
  const qc = useQueryClient();
  const form = useForm(resetPasswordSchema, { token, password: '' });

  const onSubmit = form.handleSubmit(async (data) => {
    await api.post('/auth/reset-password', data);
    // All sessions are revoked server-side after a reset.
    qc.setQueryData(currentUserKey, null);
    setDone(true);
  });

  if (!token) {
    return (
      <AuthCard title="Invalid reset link">
        <Alert>This link is missing its reset token. Please request a new link.</Alert>
        <Link to="/forgot-password" className="mt-4 block text-center text-sm font-semibold text-brand-700 hover:underline">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard title="Choose a new password">
      {done ? (
        <div className="space-y-4">
          <Alert tone="success">Your password has been reset. For your security, you've been signed out everywhere.</Alert>
          <Link to="/login" className="block text-center text-sm font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {form.formError && (
            <Alert>
              {form.formError}{' '}
              <Link to="/forgot-password" className="font-semibold underline">
                Request a new link
              </Link>
            </Alert>
          )}
          <TextField
            label="New password"
            type="password"
            autoComplete="new-password"
            required
            hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`}
            {...form.field('password')}
          />
          <Button type="submit" className="w-full" loading={form.submitting}>
            Reset password
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
