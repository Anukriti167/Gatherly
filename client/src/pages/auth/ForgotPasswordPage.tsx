import { useState } from 'react';
import { forgotPasswordSchema } from '@gatherly/shared';
import { Link } from 'react-router';
import { AuthCard } from '../../components/layouts';
import { Alert, Button, TextField } from '../../components/ui';
import { api } from '../../lib/api';
import { useForm } from '../../lib/use-form';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm(forgotPasswordSchema, { email: '' });

  const onSubmit = form.handleSubmit(async (data) => {
    await api.post('/auth/forgot-password', data);
    setSent(true);
  });

  return (
    <AuthCard title="Reset your password" subtitle="Enter your account email and we'll send you a reset link.">
      {sent ? (
        <div className="space-y-4">
          <Alert tone="success">If an account exists for that email, a reset link is on its way. It expires in 1 hour.</Alert>
          <Link to="/login" className="block text-center text-sm font-semibold text-brand-700 hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-4">
          {form.formError && <Alert>{form.formError}</Alert>}
          <TextField label="Email" type="email" autoComplete="email" required {...form.field('email')} />
          <Button type="submit" className="w-full" loading={form.submitting}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-slate-600 hover:underline">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
