import { useState } from 'react';
import type { GuestView, ProposalChange, ProposalChangeView, ProposalView } from '@gatherly/shared';
import { Alert, Badge, Button, TextAreaField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useApproveProposal, useCommentOnProposal, useObjectProposal, useReviseProposal, useWithdrawProposal } from './use-proposals';

const when = (iso: string) => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
const errText = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Something went wrong. Please try again.' : null);

const STATUS = {
  OPEN: { label: 'Open', tone: 'amber' },
  APPLIED: { label: 'Approved & applied', tone: 'green' },
  WITHDRAWN: { label: 'Withdrawn', tone: 'slate' },
  CLOSED: { label: 'Closed', tone: 'slate' },
} as const;

export function ChangeSummary({ change }: { change: ProposalChangeView }) {
  if (change.type === 'REMOVE_GUESTS') {
    return (
      <div>
        <p className="font-medium text-slate-900">Remove {change.guests.length === 1 ? 'a guest' : `${change.guests.length} guests`}</p>
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {change.guests.map((g) => (
            <li key={g.id} className={`rounded-full px-2.5 py-0.5 text-sm ring-1 ${g.stillOnList ? 'bg-red-50 text-red-800 ring-red-200' : 'bg-slate-50 text-slate-500 line-through ring-slate-200'}`}>
              {g.name} <span className="text-xs opacity-75">{g.email}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  if (change.type === 'UNPUBLISH') {
    return <p className="font-medium text-slate-900">Unpublish the event — it goes back to Draft and guests see “This event is being updated”.</p>;
  }
  if (change.type === 'COMPLETE_EVENT') {
    return (
      <p className="font-medium text-slate-900">
        Mark the event as completed now — activities that already started are completed; ones that haven't started are cancelled.
      </p>
    );
  }
  return (
    <p className="font-medium text-red-800">
      Cancel the event and all its activities{change.reason ? ` — “${change.reason}”` : ''}.
    </p>
  );
}

function Timeline({ p }: { p: ProposalView }) {
  return (
    <ol className="space-y-2 border-l-2 border-slate-200 pl-4 text-sm">
      {p.timeline.map((t, i) => (
        <li key={i}>
          <span className="text-xs text-slate-400">{when(t.at)}</span>{' '}
          {t.kind === 'revision' && (
            <span>
              <strong>{t.by}</strong> {t.version === 1 ? 'proposed' : `revised it (version ${t.version})`}: <span className="text-slate-600">{t.description}</span>
            </span>
          )}
          {t.kind === 'decision' && (
            <span>
              <strong>{t.by}</strong> {t.decision === 'APPROVE' ? 'approved' : 'objected to'} version {t.version}
              {t.comment && <span className="text-slate-600"> — “{t.comment}”</span>}
            </span>
          )}
          {t.kind === 'comment' && (
            <span>
              <strong>{t.by}</strong>: <span className="text-slate-700">{t.body}</span>
            </span>
          )}
          {t.kind === 'closed' && (
            <span className="font-medium">
              {STATUS[t.status].label}
              {t.reason && t.status !== 'APPLIED' && <span className="font-normal text-slate-600"> — {t.reason}</span>}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function ReviseForm({ eventId, p, guests, onDone }: { eventId: string; p: ProposalView; guests: GuestView[]; onDone: () => void }) {
  const revise = useReviseProposal(eventId);
  const [description, setDescription] = useState(p.description);
  const removal = p.changes.find((c) => c.type === 'REMOVE_GUESTS');
  const [guestIds, setGuestIds] = useState<string[]>(removal?.type === 'REMOVE_GUESTS' ? removal.guests.filter((g) => g.stillOnList).map((g) => g.id) : []);
  const cancel = p.changes.find((c) => c.type === 'CANCEL_EVENT');
  const [reason, setReason] = useState(cancel?.type === 'CANCEL_EVENT' ? (cancel.reason ?? '') : '');

  const changes: ProposalChange[] = p.changes.map((c) =>
    c.type === 'REMOVE_GUESTS' ? { type: 'REMOVE_GUESTS', guestIds } : c.type === 'CANCEL_EVENT' ? { type: 'CANCEL_EVENT', reason: reason || undefined } : { type: c.type },
  );

  return (
    <div className="space-y-3 rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <p className="text-sm font-medium text-slate-800">Revise — everyone else will need to approve again.</p>
      {removal && (
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-slate-800">Guests to remove</legend>
          <div className="max-h-48 space-y-1 overflow-auto">
            {guests.map((g) => (
              <label key={g.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-600"
                  checked={guestIds.includes(g.id)}
                  onChange={(e) => setGuestIds((ids) => (e.target.checked ? [...ids, g.id] : ids.filter((x) => x !== g.id)))}
                />
                {g.name} <span className="text-slate-500">{g.email}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {cancel && <TextAreaField label="Reason for cancelling (optional)" name="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />}
      <TextAreaField label="Explanation for the other organisers" name="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      {errText(revise.error) && <Alert>{errText(revise.error)}</Alert>}
      <div className="flex gap-2">
        <Button
          loading={revise.isPending}
          disabled={!description.trim() || (removal !== undefined && guestIds.length === 0)}
          onClick={() => revise.mutate({ id: p.id, expectedVersion: p.version, description, changes }, { onSuccess: onDone })}
        >
          Save revision
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** One change proposal (FR-132 – FR-153): what changes, who agreed, discussion and actions. */
export function ProposalCard({ eventId, p, guests }: { eventId: string; p: ProposalView; guests: GuestView[] }) {
  const approve = useApproveProposal(eventId);
  const object = useObjectProposal(eventId);
  const comment = useCommentOnProposal(eventId);
  const withdraw = useWithdrawProposal(eventId);
  const [mode, setMode] = useState<'idle' | 'object' | 'revise'>('idle');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [showHistory, setShowHistory] = useState(p.status === 'OPEN');
  const open = p.status === 'OPEN';
  const error = errText(approve.error ?? object.error ?? comment.error ?? withdraw.error);

  return (
    <article id={`proposal-${p.id}`} className={`scroll-mt-4 rounded-xl p-4 ring-1 transition-shadow ${open ? 'bg-amber-50/40 ring-amber-200' : 'bg-white ring-slate-200'}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900">{p.title}</h3>
          <p className="text-xs text-slate-500">
            Proposed by {p.proposer.name} · {when(p.createdAt)} · version {p.version}
          </p>
        </div>
        <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
      </header>

      <div className="mt-3 space-y-2">
        {p.changes.map((c, i) => (
          <ChangeSummary key={i} change={c} />
        ))}
        <p className="text-sm text-slate-600">
          <span className="font-medium">Why:</span> {p.description}
        </p>
      </div>

      {open && (
        <div className="mt-3">
          <p className="text-sm font-medium text-slate-800">
            {p.approvedCount} of {p.requiredCount} approved{p.objectionCount > 0 && <span className="text-red-700"> · {p.objectionCount} objection{p.objectionCount === 1 ? '' : 's'}</span>}
          </p>
          <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">
            {p.approvers.map((a) => (
              <li
                key={a.userId}
                title={a.comment ?? undefined}
                className={`rounded-full px-2 py-0.5 font-medium ${
                  a.state === 'APPROVED' ? 'bg-emerald-50 text-emerald-800' : a.state === 'OBJECTED' ? 'bg-red-50 text-red-800' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {a.state === 'APPROVED' ? '✓' : a.state === 'OBJECTED' ? '✕' : '…'} {a.name}
                {a.isYou && ' (you)'}
              </li>
            ))}
          </ul>
          {p.objectionCount > 0 && <p className="mt-1 text-xs text-slate-500">Objections don't reject a proposal — it stays open until everyone agrees, is revised, or is withdrawn.</p>}
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}

      {open && mode === 'idle' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {p.youCanDecide && (
            <>
              <Button loading={approve.isPending} onClick={() => approve.mutate({ id: p.id, expectedVersion: p.version })}>
                ✓ Approve
              </Button>
              <Button variant="secondary" onClick={() => setMode('object')}>
                Object
              </Button>
            </>
          )}
          {p.youAreProposer && (
            <>
              <Button variant="secondary" onClick={() => setMode('revise')}>
                Revise
              </Button>
              <Button variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate(p.id)}>
                Withdraw
              </Button>
            </>
          )}
        </div>
      )}

      {open && mode === 'object' && (
        <div className="mt-3 space-y-2">
          <TextAreaField label="What do you disagree with?" name="objection" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <Button
              variant="danger"
              loading={object.isPending}
              disabled={!text.trim()}
              onClick={() => object.mutate({ id: p.id, expectedVersion: p.version, comment: text.trim() }, { onSuccess: () => (setText(''), setMode('idle')) })}
            >
              Send objection
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {open && mode === 'revise' && (
        <div className="mt-3">
          <ReviseForm eventId={eventId} p={p} guests={guests} onDone={() => setMode('idle')} />
        </div>
      )}

      <div className="mt-4 border-t border-slate-200/70 pt-3">
        <button type="button" aria-expanded={showHistory} onClick={() => setShowHistory((s) => !s)} className="text-sm font-medium text-brand-700 hover:underline">
          {showHistory ? 'Hide discussion' : `Show discussion (${p.timeline.length})`}
        </button>
        {showHistory && (
          <div className="mt-3 space-y-3">
            <Timeline p={p} />
            {open && (
              <div className="flex items-end gap-2">
                <TextAreaField className="flex-1" label="Add to the discussion" name="comment" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
                <Button
                  variant="secondary"
                  loading={comment.isPending}
                  disabled={!note.trim()}
                  onClick={() => comment.mutate({ id: p.id, body: note.trim() }, { onSuccess: () => setNote('') })}
                >
                  Post
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
