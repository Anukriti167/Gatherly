import { useState } from 'react';
import type { ApprovalRoundView, EventDetail, PublicationState, RoundApproverView } from '@gatherly/shared';
import { Alert, Badge, Button, Card, Spinner, TextAreaField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { ProposeButton } from '../proposals/ProposeButton';
import { useApprove, usePublication, useRequestChanges, useSubmitForApproval } from './use-publication';

const when = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

const errorText = (e: unknown) => (e instanceof ApiError ? e.message : e ? 'Something went wrong. Please try again.' : null);

function ApproverList({ approvers }: { approvers: RoundApproverView[] }) {
  return (
    <ul className="mt-3 space-y-2">
      {approvers.map((a) => (
        <li key={a.userId} className="flex flex-wrap items-start justify-between gap-2 text-sm">
          <div>
            <span className="font-medium text-slate-900">{a.name}</span>
            {a.isYou && <span className="text-slate-500"> (you)</span>}
            {a.comment && <p className="mt-0.5 text-slate-600">“{a.comment}”</p>}
          </div>
          <span className="flex items-center gap-2">
            {a.decidedAt && <span className="text-xs text-slate-400">{when(a.decidedAt)}</span>}
            {a.state === 'APPROVED' ? (
              <Badge tone="green">✓ Approved</Badge>
            ) : a.state === 'CHANGES_REQUESTED' ? (
              <Badge tone="red">Changes requested</Badge>
            ) : (
              <Badge tone="amber">Waiting</Badge>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Progress({ round }: { round: ApprovalRoundView }) {
  const pct = round.requiredCount ? Math.round((round.approvedCount / round.requiredCount) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium text-slate-800">
          {round.approvedCount} of {round.requiredCount} organisers approved
        </span>
        <span className="text-slate-500">version {round.eventVersion}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={round.approvedCount} aria-valuemin={0} aria-valuemax={round.requiredCount}>
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DecisionForm({ event, state }: { event: EventDetail; state: PublicationState }) {
  const approve = useApprove(event.id);
  const requestChanges = useRequestChanges(event.id);
  const [mode, setMode] = useState<'idle' | 'changes'>('idle');
  const [comment, setComment] = useState('');
  const expectedVersion = state.current?.eventVersion ?? event.version;
  const error = errorText(approve.error ?? requestChanges.error);

  if (!state.youCanApprove) return null;

  return (
    <div className="mt-4 rounded-xl bg-brand-50 p-4 ring-1 ring-brand-200">
      <p className="text-sm font-medium text-brand-900">Your approval is needed for version {expectedVersion}.</p>
      <p className="text-sm text-brand-900/80">Review the details and activities below, then decide.</p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      {mode === 'changes' ? (
        <div className="mt-3 space-y-3">
          <TextAreaField label="What should change?" name="comment" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} hint="The event goes back to Draft so it can be edited." />
          <div className="flex gap-2">
            <Button variant="danger" loading={requestChanges.isPending} disabled={!comment.trim()} onClick={() => requestChanges.mutate({ expectedVersion, comment: comment.trim() })}>
              Send back to draft
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button loading={approve.isPending} onClick={() => approve.mutate({ expectedVersion })}>
            ✓ Approve
          </Button>
          <Button variant="secondary" onClick={() => setMode('changes')}>
            Request changes
          </Button>
        </div>
      )}
    </div>
  );
}

function History({ rounds }: { rounds: ApprovalRoundView[] }) {
  const [open, setOpen] = useState(false);
  if (!rounds.length) return null;
  const label: Record<ApprovalRoundView['status'], string> = {
    OPEN: 'Open',
    APPROVED: 'Approved',
    CHANGES_REQUESTED: 'Changes requested',
    SUPERSEDED: 'Reset by an edit',
    WITHDRAWN: 'Withdrawn',
  };
  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="text-sm font-medium text-brand-700 hover:underline">
        {open ? 'Hide' : 'Show'} approval history ({rounds.length})
      </button>
      {open && (
        <ol className="mt-3 space-y-3">
          {rounds.map((r) => (
            <li key={r.id} className="rounded-lg bg-slate-50 p-3 text-sm ring-1 ring-slate-200">
              <p className="font-medium text-slate-800">
                {label[r.status]} · version {r.eventVersion} · started by {r.initiatedByName} on {when(r.createdAt)}
              </p>
              {r.reason && <p className="text-slate-500">{r.reason}</p>}
              <ApproverList approvers={r.approvers} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Publication workflow with unanimous approval (FR-222 – FR-230). */
export function PublicationCard({ event }: { event: EventDetail }) {
  const { data: state, isPending } = usePublication(event.id);
  const submit = useSubmitForApproval(event.id);

  if (isPending || !state) return <Spinner label="Loading approval status" />;
  const round = state.current;
  const canSubmit = event.allowedActions.includes('publication.submit');
  const started = new Date(event.startsAt) <= new Date();
  const submitError = errorText(submit.error);

  return (
    <Card className={state.eventStatus === 'PENDING_APPROVAL' ? 'ring-2 ring-amber-300' : undefined}>
      <h2 className="text-lg font-semibold">Approval & publishing</h2>

      {state.eventStatus === 'DRAFT' && (
        <>
          {round?.status === 'CHANGES_REQUESTED' && (
            <div className="mt-3">
              <Alert tone="error">
                Changes were requested:{' '}
                {round.approvers
                  .filter((a) => a.state === 'CHANGES_REQUESTED')
                  .map((a) => `${a.name}: “${a.comment}”`)
                  .join(' · ')}
              </Alert>
            </div>
          )}
          <p className="mt-2 text-sm text-slate-600">
            When everything is ready, submit the event. It's published once <strong>every organiser</strong> approves — you count as approving
            when you submit. Guests can only be invited after publishing.
          </p>
          {submitError && (
            <div className="mt-3">
              <Alert>{submitError}</Alert>
            </div>
          )}
          {canSubmit && (
            <Button className="mt-4" loading={submit.isPending} onClick={() => submit.mutate({ expectedVersion: event.version })}>
              Submit for approval
            </Button>
          )}
        </>
      )}

      {state.eventStatus === 'PENDING_APPROVAL' && round && (
        <div className="mt-3">
          <Progress round={round} />
          {round.reason && round.reason !== 'Submitted for publication' && <p className="mt-2 text-sm text-amber-700">{round.reason}.</p>}
          <ApproverList approvers={round.approvers} />
          <DecisionForm event={event} state={state} />
          {!state.youCanApprove && (
            <p className="mt-3 text-sm text-slate-500">Waiting for the other organisers. Editing the event now will reset everyone's approval.</p>
          )}
        </div>
      )}

      {state.eventStatus === 'COMPLETED' && (
        <div className="mt-3">
          <Alert tone="info">
            🏁 This event has finished and is marked as completed. It's kept in your history under the dashboard's <strong>Completed</strong> tab
            and can no longer be changed.
          </Alert>
        </div>
      )}

      {state.eventStatus === 'PUBLISHED' && (
        <div className="mt-3">
          <Alert tone="success">
            Published{round?.closedAt ? ` on ${when(round.closedAt)}` : ''} — approved by all {round?.requiredCount ?? ''} organiser
            {round?.requiredCount === 1 ? '' : 's'}. Changes now need everyone's approval through change proposals. It's marked as completed
            automatically when it ends.
          </Alert>
          {event.allowedActions.includes('proposal.create') && (
            <>
              {/* Equal-width, equal-height buttons; an opened proposal form spans the full row. */}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {started ? (
                  <ProposeButton
                    eventId={event.id}
                    variant="secondary"
                    className="h-full w-full"
                    label="Propose marking as completed"
                    title="Mark the event as completed"
                    prompt="Why should the event be marked as completed now? (It completes automatically when it ends.)"
                    changes={() => [{ type: 'COMPLETE_EVENT' }]}
                  />
                ) : (
                  // Visible but disabled before the start, so organisers know the option exists.
                  <Button variant="secondary" className="h-full w-full" disabled aria-describedby="complete-hint">
                    Propose marking as completed
                  </Button>
                )}
                <ProposeButton
                  eventId={event.id}
                  variant="secondary"
                  className="h-full w-full"
                  label="Propose unpublishing"
                  title="Unpublish the event"
                  prompt="Why should the event be unpublished?"
                  changes={() => [{ type: 'UNPUBLISH' }]}
                />
                <ProposeButton
                  eventId={event.id}
                  variant="danger"
                  className="h-full w-full"
                  label="Propose cancelling"
                  title="Cancel the event"
                  prompt="Why should the event be cancelled? Guests will be told it's cancelled."
                  changes={(reason) => [{ type: 'CANCEL_EVENT', reason }]}
                />
              </div>
              {!started && (
                <p id="complete-hint" className="mt-2 text-xs text-slate-500">
                  “Mark as completed” becomes available once the event starts ({formatDateTime(event.startsAt, event.timezone)}). It also
                  completes automatically when it ends.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {state.eventStatus === 'CANCELLED' && (
        <div className="mt-3">
          <Alert>This event was cancelled after every organiser approved. It can no longer be changed.</Alert>
        </div>
      )}

      <History rounds={state.history} />
    </Card>
  );
}
