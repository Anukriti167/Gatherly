import { loginSchema } from '@gatherly/shared';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { AuthCard, safeNext } from '../../components/layouts';
import { Alert, Button, TextField } from '../../components/ui';
import { useLogin } from '../../features/auth/use-auth';
import { useForm } from '../../lib/use-form';

export function LoginPage() {
  const login = useLogin();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const form = useForm(loginSchema, { email: '', password: '' });

  const onSubmit = form.handleSubmit(async (data) => {
    await login.mutateAsync(data);
    navigate(safeNext(params.get('next')), { replace: true });
  });

  return (
    <AuthCard
      title="Welcome back"
      subtitle={
        <>
          New to Gatherly?{' '}
          <Link to="/register" className="font-semibold text-brand-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {form.formError && <Alert>{form.formError}</Alert>}
        <TextField label="Email" type="email" autoComplete="email" required {...form.field('email')} />
        <TextField label="Password" type="password" autoComplete="current-password" required {...form.field('password')} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={form.submitting}>
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
