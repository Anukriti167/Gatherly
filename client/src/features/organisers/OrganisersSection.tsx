import { useState } from 'react';
import { inviteCoAdminSchema, type EventDetail, type EventMember } from '@gatherly/shared';
import { Alert, Badge, Button, Card, Spinner, TextField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useForm } from '../../lib/use-form';
import { useInviteCoAdmin, useOrganisers, useRemoveOrganiser } from './use-organisers';

function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function MemberRow({ member, canManage, onRemove, removing }: { member: EventMember; canManage: boolean; onRemove: () => void; removing: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const pending = member.status === 'INVITED';
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${pending ? 'bg-slate-100 text-slate-500' : 'bg-brand-100 text-brand-700'}`}>
          {initials(member.name)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-medium text-slate-900">
            {member.name} {member.isYou && <span className="font-normal text-slate-500">(you)</span>}
          </p>
          <p className="truncate text-sm text-slate-500">{member.email}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {member.role === 'OWNER' ? <Badge tone="brand">Owner</Badge> : pending ? <Badge tone="amber">Invited</Badge> : <Badge>Co-admin</Badge>}
        {canManage && member.role !== 'OWNER' &&
          (confirming ? (
            <>
              <Button variant="danger" loading={removing} onClick={onRemove}>
                {pending ? 'Cancel invite' : 'Remove'}
              </Button>
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="ghost" onClick={() => setConfirming(true)} aria-label={`${pending ? 'Cancel invitation for' : 'Remove'} ${member.name}`}>
              {pending ? 'Cancel invite' : 'Remove'}
            </Button>
          ))}
      </div>
    </li>
  );
}

function InviteForm({ eventId }: { eventId: string }) {
  const invite = useInviteCoAdmin(eventId);
  const [sent, setSent] = useState<string | null>(null);
  const form = useForm(inviteCoAdminSchema, { email: '' });

  const submit = form.handleSubmit(async ({ email }) => {
    setSent(null);
    const member = await invite.mutateAsync(email);
    setSent(member.name);
    form.setValues({ email: '' });
  });

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      {form.formError && <Alert>{form.formError}</Alert>}
      {sent && <Alert tone="success">Invitation sent to {sent}. They'll see it on their dashboard.</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <TextField
          className="min-w-64 flex-1"
          label="Invite a co-admin by email"
          type="email"
          autoComplete="off"
          placeholder="name@example.com"
          hint="They need a Gatherly account. Co-admins can edit the event but can't manage organisers."
          {...form.field('email')}
        />
        <Button type="submit" loading={form.submitting} className="mb-6">
          Send invite
        </Button>
      </div>
    </form>
  );
}

/** FR-060 – FR-066 — the event's owner and co-admins. */
export function OrganisersSection({ event }: { event: EventDetail }) {
  const { data: members, isPending, error } = useOrganisers(event.id);
  const remove = useRemoveOrganiser(event.id);
  const [actionError, setActionError] = useState<string | null>(null);
  const canManage = event.allowedActions.includes('coadmins.manage');

  return (
    <Card>
      <h2 className="text-lg font-semibold">Organisers</h2>
      <p className="text-sm text-slate-500">Everyone here plans the event together. Publishing and changes after publishing need all of them to approve.</p>

      {actionError && (
        <div className="mt-4">
          <Alert>{actionError}</Alert>
        </div>
      )}

      {isPending ? (
        <Spinner label="Loading organisers" />
      ) : error ? (
        <div className="mt-4">
          <Alert>Could not load organisers. {error.message}</Alert>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              canManage={canManage}
              removing={remove.isPending && remove.variables === m.id}
              onRemove={() => {
                setActionError(null);
                remove.mutate(m.id, { onError: (e) => setActionError(e instanceof ApiError ? e.message : 'Could not remove this organiser.') });
              }}
            />
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <InviteForm eventId={event.id} />
        </div>
      )}
    </Card>
  );
}
