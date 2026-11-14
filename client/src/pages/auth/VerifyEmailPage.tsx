import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { AuthCard } from '../../components/layouts';
import { Alert, Spinner } from '../../components/ui';
import { currentUserKey } from '../../features/auth/use-auth';
import { api, ApiError } from '../../lib/api';

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const qc = useQueryClient();
  const [state, setState] = useState<'pending' | 'ok' | 'error'>(token ? 'pending' : 'error');
  const [message, setMessage] = useState('This confirmation link is missing its token.');
  const started = useRef(false);

  useEffect(() => {
    // Guard against React StrictMode double-invoking effects (token is single-use).
    if (!token || started.current) return;
    started.current = true;
    api
      .post('/auth/verify-email', { token })
      .then(() => {
        setState('ok');
        void qc.invalidateQueries({ queryKey: currentUserKey });
      })
      .catch((err: unknown) => {
        setState('error');
        setMessage(err instanceof ApiError ? err.message : 'Something went wrong.');
      });
  }, [token, qc]);

  return (
    <AuthCard title="Confirm your email">
      {state === 'pending' && <Spinner label="Confirming your email" />}
      {state === 'ok' && <Alert tone="success">Thanks — your email is confirmed.</Alert>}
      {state === 'error' && <Alert>{message}</Alert>}
      <Link to="/dashboard" className="mt-4 block text-center text-sm font-semibold text-brand-700 hover:underline">
        Go to dashboard
      </Link>
    </AuthCard>
  );
}
