import { useNavigate } from 'react-router';
import { Alert, Button } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDateRange } from '../../lib/format';
import { useMyInvitations, useRespondToInvitation } from './use-organisers';

/** Pending co-admin invitations for the signed-in user, shown on the dashboard. */
export function InvitationsPanel() {
  const { data: invitations } = useMyInvitations();
  const respond = useRespondToInvitation();
  const navigate = useNavigate();
  if (!invitations?.length) return null;

  return (
    <section aria-labelledby="invitations-heading" className="rounded-2xl bg-brand-50 p-5 ring-1 ring-brand-200">
      <h2 id="invitations-heading" className="font-semibold text-brand-900">
        You've been invited to co-organise {invitations.length === 1 ? 'an event' : `${invitations.length} events`}
      </h2>
      {respond.error && (
        <div className="mt-3">
          <Alert>{respond.error instanceof ApiError ? respond.error.message : 'Something went wrong.'}</Alert>
        </div>
      )}
      <ul className="mt-3 space-y-2">
        {invitations.map((inv) => {
          const busy = respond.isPending && respond.variables?.eventId === inv.eventId;
          return (
            <li key={inv.membershipId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white p-4 ring-1 ring-brand-100">
              <div>
                <p className="font-medium text-slate-900">{inv.eventName}</p>
                <p className="text-sm text-slate-600">
                  {formatDateRange(inv.eventStartsAt, inv.eventStartsAt, inv.eventTimezone)}
                  {inv.invitedByName && <> · invited by {inv.invitedByName}</>}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  loading={busy && respond.variables?.accept === true}
                  disabled={busy}
                  onClick={() => respond.mutate({ eventId: inv.eventId, accept: true }, { onSuccess: () => navigate(`/events/${inv.eventId}`) })}
                >
                  Accept
                </Button>
                <Button variant="secondary" loading={busy && respond.variables?.accept === false} disabled={busy} onClick={() => respond.mutate({ eventId: inv.eventId, accept: false })}>
                  Decline
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
