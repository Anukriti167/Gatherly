import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Spinner } from '../../components/ui';
import { useOpenInvitation } from '../../features/guest-site/use-guest';
import { ApiError } from '../../lib/api';

/**
 * /i/:token — the link from the invitation email. Exchanges the token for a guest session, then
 * moves to /my-event so the token doesn't stay in the address bar or browser history.
 */
export function InvitationLandingPage() {
  const { token = '' } = useParams();
  const open = useOpenInvitation();
  const navigate = useNavigate();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice in development
    started.current = true;
    open.mutate(token, {
      onSuccess: () => navigate('/my-event', { replace: true }),
      onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try the link again.'),
    });
  }, [token, open, navigate]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-50 to-white px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        {error ? (
          <>
            <p className="text-4xl" aria-hidden>
              ✉️
            </p>
            <h1 className="mt-3 text-xl font-bold">This link can't be opened</h1>
            <p className="mt-2 text-slate-600">{error}</p>
            <p className="mt-4 text-sm text-slate-500">Please use the most recent invitation email, or ask the organisers to send you a new one.</p>
          </>
        ) : (
          <>
            <Spinner label="Opening your invitation" />
            <p className="text-slate-600">Opening your invitation…</p>
          </>
        )}
      </div>
    </div>
  );
}
