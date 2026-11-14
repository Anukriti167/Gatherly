import { PASSWORD_MIN_LENGTH, registerSchema } from '@gatherly/shared';
import { Link, useNavigate } from 'react-router';
import { AuthCard } from '../../components/layouts';
import { Alert, Button, TextField } from '../../components/ui';
import { useRegister } from '../../features/auth/use-auth';
import { useForm } from '../../lib/use-form';

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const form = useForm(registerSchema, { name: '', email: '', password: '' });

  const onSubmit = form.handleSubmit(async (data) => {
    await register.mutateAsync(data);
    navigate('/dashboard', { replace: true });
  });

  return (
    <AuthCard
      title="Create your account"
      subtitle={
        <>
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-brand-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField label="Full name" autoComplete="name" required {...form.field('name')} />
        <TextField label="Email" type="email" autoComplete="email" required {...form.field('email')} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint={`At least ${PASSWORD_MIN_LENGTH} characters, with letters and numbers.`}
          {...form.field('password')}
        />
        <Button type="submit" className="w-full" loading={form.submitting}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
