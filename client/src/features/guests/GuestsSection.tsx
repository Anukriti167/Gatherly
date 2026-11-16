import { useMemo, useState } from 'react';
import type { ActivityDetail, EventDetail, GuestInvitationView, GuestView } from '@gatherly/shared';
import { Alert, Button, Card, SelectField, Spinner } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { downloadGuestTemplate } from '../../lib/download';
import { useActivities } from '../activities/use-activities';
import { GuestForm, type GuestFormValues } from './GuestForm';
import { ImportGuests } from './ImportGuests';
import { ProposeButton } from '../proposals/ProposeButton';
import { useProposals } from '../proposals/use-proposals';
import { InvitationStatus } from '../invitations/InvitationStatus';
import { useInvitations, useRetryInvitation, useRevokeInvitation, useSendInvitations } from '../invitations/use-invitations';
import { useAddGuest, useGuests, useRemoveGuest, useRsvpOverview, useUpdateGuest } from './use-guests';

type Mode = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; guest: GuestView } | { kind: 'import' };

const emptyGuest: GuestFormValues = { name: '', email: '', phone: '', allActivities: true, activityIds: [] };

const invitedTo = (g: GuestView, activityId: string) => g.allActivities || g.activityIds.includes(activityId);

function GuestRow({
  guest,
  activities,
  eventId,
  canEdit,
  canRemove,
  canProposeRemoval,
  removalPending,
  onEdit,
  onRemove,
  onProposed,
  removing,
  invitation,
  canInvite,
  canRevokeInvite,
  onInvite,
  onRevokeInvite,
  onRetry,
  inviteBusy,
  answers,
}: {
  guest: GuestView;
  activities: ActivityDetail[];
  eventId: string;
  canEdit: boolean;
  canRemove: boolean;
  /** Published event: removal needs a change proposal approved by all organisers. */
  canProposeRemoval: boolean;
  removalPending: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onProposed: (applied: boolean) => void;
  removing: boolean;
  invitation: GuestInvitationView | undefined;
  /** Event is published → personal invitation links can be sent (FR-226). */
  canInvite: boolean;
  canRevokeInvite: boolean;
  onInvite: () => void;
  onRevokeInvite: () => void;
  onRetry: () => void;
  inviteBusy: boolean;
  /** activityId → this guest's RSVP answer (missing = not answered). */
  answers: Record<string, 'CONFIRMED' | 'DECLINED'>;
}) {
  const mark = (activityId: string) =>
    answers[activityId] === 'CONFIRMED' ? (
      <span className="ml-1 font-bold text-emerald-700" title="Going">✓</span>
    ) : answers[activityId] === 'DECLINED' ? (
      <span className="ml-1 font-bold text-red-600" title="Not going">✕</span>
    ) : null;
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const invited = invitation?.status === 'INVITED';
  const [confirming, setConfirming] = useState(false);
  const mine = guest.allActivities ? null : activities.filter((a) => guest.activityIds.includes(a.id));
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">
          {guest.name}
          {removalPending && <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">Removal awaiting approval</span>}
        </p>
        <p className="text-sm text-slate-500">
          {guest.email}
          {guest.phone && <> · {guest.phone}</>}
        </p>
        <p className="mt-1 flex flex-wrap gap-1 text-xs">
          {(canInvite || invitation?.status !== 'NOT_INVITED') && <InvitationStatus inv={invitation} />}
          {mine === null ? (
            <>
              <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">All activities</span>
              {activities
                .filter((a) => answers[a.id])
                .map((a) => (
                  <span key={a.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                    {a.name}
                    {mark(a.id)}
                  </span>
                ))}
            </>
          ) : mine.length === 0 ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">Not assigned to any activity</span>
          ) : (
            mine.map((a) => (
              <span key={a.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">
                {a.name}
                {mark(a.id)}
              </span>
            ))
          )}
        </p>
      </div>
      {canEdit && (
        <div className="flex flex-wrap justify-end gap-1">
          {canInvite && invitation?.delivery === 'FAILED' && invitation.status === 'INVITED' ? (
            <Button variant="ghost" loading={inviteBusy} onClick={onRetry}>
              Retry email
            </Button>
          ) : canInvite ? (
            <Button variant="ghost" loading={inviteBusy} onClick={onInvite} aria-label={`${invited ? 'Resend invitation to' : 'Invite'} ${guest.name}`}>
              {invited ? 'Resend' : 'Invite'}
            </Button>
          ) : null}
          {canRevokeInvite && invited &&
            (confirmRevoke ? (
              <>
                <Button variant="danger" loading={inviteBusy} onClick={() => (setConfirmRevoke(false), onRevokeInvite())}>
                  Revoke link
                </Button>
                <Button variant="ghost" onClick={() => setConfirmRevoke(false)}>
                  Keep
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmRevoke(true)} aria-label={`Revoke ${guest.name}'s invitation link`}>
                Revoke link
              </Button>
            ))}
          <Button variant="ghost" onClick={onEdit} aria-label={`Edit ${guest.name}`}>
            Edit
          </Button>
          {canProposeRemoval && !removalPending && (
            <ProposeButton
              eventId={eventId}
              label="Propose removal"
              title={`Remove ${guest.name}`}
              prompt={`Why should ${guest.name} be removed?`}
              changes={() => [{ type: 'REMOVE_GUESTS', guestIds: [guest.id] }]}
              onCreated={onProposed}
            />
          )}
          {!canRemove ? null : confirming ? (
            <>
              <Button variant="danger" loading={removing} onClick={onRemove}>
                Remove
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)} aria-label={`Remove ${guest.name}`}>
              Remove
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** The event's shared guest list (FR-068 – FR-082). Organisers only. */
export function GuestsSection({ event }: { event: EventDetail }) {
  const { data: guests, isPending, error } = useGuests(event.id);
  const { data: activities = [] } = useActivities(event.id);
  const add = useAddGuest(event.id);
  const update = useUpdateGuest(event.id);
  const remove = useRemoveGuest(event.id);
  // Invitations (FR-083 – FR-091): only once published (FR-226); revoking also allowed afterwards.
  const canInvite = event.allowedActions.includes('invitations.send');
  const canRevokeInvite = event.allowedActions.includes('invitations.revoke');
  const { data: invitations = [] } = useInvitations(event.id, canInvite || canRevokeInvite);
  const invitationOf = new Map(invitations.map((i) => [i.guestId, i]));
  const sendInvites = useSendInvitations(event.id);
  const revokeInvite = useRevokeInvitation(event.id);
  const retryInvite = useRetryInvitation(event.id);
  const uninvited = invitations.filter((i) => i.status === 'NOT_INVITED').length;
  const { data: rsvps } = useRsvpOverview(event.id);
  const rsvpOf = new Map(rsvps?.activities.map((r) => [r.activityId, r]) ?? []);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [query, setQuery] = useState('');
  const [activityFilter, setActivityFilter] = useState('');
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  // Adding/editing guests is direct at any time; removal after publishing needs a change proposal.
  const canEdit = event.allowedActions.includes('guests.manage');
  const canRemove = event.allowedActions.includes('guests.remove');
  const canProposeRemoval = !canRemove && event.allowedActions.includes('proposal.create');
  // Guests that already have an open removal proposal.
  const { data: proposals = [] } = useProposals(event.id);
  const pendingRemovals = new Set(
    proposals.filter((p) => p.status === 'OPEN').flatMap((p) => p.changes.flatMap((c) => (c.type === 'REMOVE_GUESTS' ? c.guests.map((g) => g.id) : []))),
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (guests ?? []).filter(
      (g) => (!q || g.name.toLowerCase().includes(q) || g.email.includes(q)) && (!activityFilter || invitedTo(g, activityFilter)),
    );
  }, [guests, query, activityFilter]);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Guests {guests && <span className="font-normal text-slate-500">({guests.length})</span>}</h2>
          <p className="text-sm text-slate-500">One list for the whole event. Each guest only sees the activities they're invited to.</p>
        </div>
        {canEdit && mode.kind === 'list' && (
          <div className="flex flex-wrap gap-2">
            {canInvite &&
              (uninvited > 0 ? (
                <Button
                  loading={sendInvites.isPending && sendInvites.variables === undefined}
                  onClick={() =>
                    sendInvites.mutate(undefined, {
                      onSuccess: (r) => setNotice({ tone: 'success', text: `${r.queued} invitation${r.queued === 1 ? '' : 's'} on the way — each guest gets their own personal link.` }),
                      onError: (e) => setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not send invitations.' }),
                    })
                  }
                >
                  ✉ Send invitations ({uninvited})
                </Button>
              ) : (
                // Stays visible so it's clear why there's nothing to send. Bulk re-send is deliberately not
                // offered: re-sending replaces each guest's link, which would break every link already sent.
                <Button
                  variant="secondary"
                  disabled
                  title="Everyone on the list has been invited. Guests you add later can be invited here; use Resend on a guest to send them a fresh link."
                >
                  ✓ Everyone is invited
                </Button>
              ))}
            <Button variant="ghost" onClick={() => downloadGuestTemplate(activities.map((a) => a.name))}>
              ⬇ CSV template
            </Button>
            <Button variant="secondary" onClick={() => setMode({ kind: 'import' })}>
              Import CSV
            </Button>
            <Button onClick={() => setMode({ kind: 'add' })}>+ Add guest</Button>
          </div>
        )}
      </div>

      {canEdit && !canRemove && event.status === 'PUBLISHED' && (
        <div className="mt-3">
          <Alert tone="info">You can add and edit guests at any time; the other organisers are emailed about each change. Removing a guest cuts off their access, so after publishing use “Propose removal” — it happens once every organiser approves.</Alert>
        </div>
      )}
      {notice && (
        <div className="mt-3">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      )}

      {mode.kind !== 'list' && (
        <div className="mt-4">
          {mode.kind === 'import' ? (
            <ImportGuests
              eventId={event.id}
              activities={activities}
              onCancel={() => setMode({ kind: 'list' })}
              onDone={(n) => {
                setMode({ kind: 'list' });
                setNotice({ tone: 'success', text: `${n} guest${n === 1 ? '' : 's'} added.` });
              }}
            />
          ) : (
            <GuestForm
              key={mode.kind === 'edit' ? mode.guest.id : 'new'}
              activities={activities}
              submitLabel={mode.kind === 'edit' ? 'Save guest' : 'Add guest'}
              initial={
                mode.kind === 'edit'
                  ? { name: mode.guest.name, email: mode.guest.email, phone: mode.guest.phone ?? '', allActivities: mode.guest.allActivities, activityIds: mode.guest.activityIds }
                  : emptyGuest
              }
              onCancel={() => setMode({ kind: 'list' })}
              onSubmit={async (values) => {
                if (mode.kind === 'edit') await update.mutateAsync({ id: mode.guest.id, changes: values });
                else await add.mutateAsync(values);
                setNotice({ tone: 'success', text: `${values.name} ${mode.kind === 'edit' ? 'updated' : 'added'}.` });
                setMode({ kind: 'list' });
              }}
            />
          )}
        </div>
      )}

      {/* FR-081 — how many guests each activity has */}
      {guests && guests.length > 0 && activities.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter guests by activity">
          <button
            type="button"
            aria-pressed={activityFilter === ''}
            onClick={() => setActivityFilter('')}
            className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${activityFilter === '' ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          >
            All guests <span className={activityFilter === '' ? 'text-brand-100' : 'text-slate-500'}>· {guests.length}</span>
          </button>
          {activities.map((a) => {
            const n = guests.filter((g) => invitedTo(g, a.id)).length;
            const active = activityFilter === a.id;
            return (
              <button
                key={a.id}
                type="button"
                aria-pressed={active}
                onClick={() => setActivityFilter(active ? '' : a.id)}
                className={`rounded-lg px-3 py-1.5 text-sm ring-1 ${active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
              >
                {a.name} <span className={active ? 'text-brand-100' : 'text-slate-500'}>· {n}</span>
                {rsvpOf.get(a.id) && (rsvpOf.get(a.id)!.confirmed > 0 || rsvpOf.get(a.id)!.declined > 0) && (
                  <span className={`ml-1.5 text-xs ${active ? 'text-white' : 'text-slate-600'}`} title={`${rsvpOf.get(a.id)!.confirmed} going · ${rsvpOf.get(a.id)!.declined} not going · ${rsvpOf.get(a.id)!.pending} no answer`}>
                    <span className={active ? '' : 'text-emerald-700'}>✓{rsvpOf.get(a.id)!.confirmed}</span>{' '}
                    <span className={active ? '' : 'text-red-600'}>✕{rsvpOf.get(a.id)!.declined}</span>
                  </span>
                )}
                {a.capacity && n > a.capacity && <span className="ml-1 text-amber-600" title="More guests than capacity">⚠</span>}
              </button>
            );
          })}
        </div>
      )}

      {guests && guests.length > 5 && (
        // Activity filtering is done by the chips above; this is a single, full-width search.
        <div className="mt-4">
          <div className="relative">
            <svg aria-hidden viewBox="0 0 20 20" fill="currentColor" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 1 0 3.47 9.77l3.13 3.13a.75.75 0 1 0 1.06-1.06l-3.13-3.13A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z" clipRule="evenodd" />
            </svg>
            <input
              type="search"
              aria-label="Search guests"
              placeholder="Search guests by name or email…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="block w-full rounded-lg border border-slate-300 bg-white py-2.5 pl-9 pr-9 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                ✕
              </button>
            )}
          </div>
          {(query || activityFilter) && (
            <p className="mt-2 text-xs text-slate-500" role="status">
              Showing {visible.length} of {guests.length} guests
            </p>
          )}
        </div>
      )}

      {isPending ? (
        <Spinner label="Loading guests" />
      ) : error ? (
        <div className="mt-4">
          <Alert>Could not load guests. {error.message}</Alert>
        </div>
      ) : guests.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
          No guests yet.{canEdit && ' Add them one by one or import a spreadsheet — before or after publishing.'}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {visible.map((g) => (
            <GuestRow
              key={g.id}
              guest={g}
              activities={activities}
              canEdit={canEdit}
              canRemove={canRemove}
              invitation={invitationOf.get(g.id)}
              answers={rsvps?.answers[g.id] ?? {}}
              canInvite={canInvite}
              canRevokeInvite={canRevokeInvite}
              inviteBusy={
                (sendInvites.isPending && sendInvites.variables?.[0] === g.id) ||
                (revokeInvite.isPending && revokeInvite.variables === g.id) ||
                (retryInvite.isPending && retryInvite.variables === g.id)
              }
              onInvite={() =>
                sendInvites.mutate([g.id], {
                  onSuccess: () => setNotice({ tone: 'success', text: `Invitation to ${g.name} is on the way.` }),
                  onError: (e) => setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not send the invitation.' }),
                })
              }
              onRevokeInvite={() =>
                revokeInvite.mutate(g.id, { onSuccess: () => setNotice({ tone: 'success', text: `${g.name}'s link no longer works.` }) })
              }
              onRetry={() => retryInvite.mutate(g.id, { onSuccess: () => setNotice({ tone: 'success', text: `Retrying the email to ${g.name}.` }) })}
              eventId={event.id}
              canProposeRemoval={canProposeRemoval}
              removalPending={pendingRemovals.has(g.id)}
              onProposed={(applied) =>
                setNotice({ tone: 'success', text: applied ? `${g.name} removed.` : `Removal of ${g.name} sent to the other organisers for approval.` })
              }
              removing={remove.isPending && remove.variables === g.id}
              onEdit={() => {
                setNotice(null);
                setMode({ kind: 'edit', guest: g });
              }}
              onRemove={() =>
                remove.mutate(
                  g.id,
                  {
                    onSuccess: () => setNotice({ tone: 'success', text: `${g.name} removed.` }),
                    onError: (e) => setNotice({ tone: 'error', text: e instanceof ApiError ? e.message : 'Could not remove the guest.' }),
                  },
                )
              }
            />
          ))}
          {visible.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No guests match your search.</li>}
        </ul>
      )}
    </Card>
  );
}
