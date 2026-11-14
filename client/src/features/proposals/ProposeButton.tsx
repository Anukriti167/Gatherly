import { useState } from 'react';
import type { ProposalChange } from '@gatherly/shared';
import { Alert, Button, TextAreaField } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useCreateProposal } from './use-proposals';

/**
 * "Propose …" button → asks for a reason → creates a change proposal that every organiser must
 * approve. Used for guest removal, unpublishing and cancelling published events.
 */
export function ProposeButton({
  eventId,
  label,
  title,
  changes,
  prompt,
  variant = 'ghost',
  onCreated,
  className,
}: {
  eventId: string;
  label: string;
  title: string;
  changes: (reason: string) => ProposalChange[];
  prompt: string;
  variant?: 'ghost' | 'secondary' | 'danger';
  onCreated?: (applied: boolean) => void;
  /** Extra classes for the button (e.g. 'w-full' in a row of equal buttons). */
  className?: string;
}) {
  const create = useCreateProposal(eventId);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  if (!open) {
    return (
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }

  return (
    // col-span-full: when opened inside a grid of buttons, the form takes the whole row.
    <div className="col-span-full w-full space-y-2 rounded-lg bg-white p-3 ring-1 ring-slate-200">
      <TextAreaField label={prompt} name="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} hint="All organisers must approve before this happens. You count as approving." />
      {create.error && <Alert>{create.error instanceof ApiError ? create.error.message : 'Could not create the proposal.'}</Alert>}
      <div className="flex gap-2">
        <Button
          variant={variant === 'danger' ? 'danger' : 'primary'}
          loading={create.isPending}
          disabled={!reason.trim()}
          onClick={() =>
            create.mutate(
              { title, description: reason.trim(), changes: changes(reason.trim()) },
              {
                onSuccess: (p) => {
                  setOpen(false);
                  setReason('');
                  onCreated?.(p.status === 'APPLIED');
                },
              },
            )
          }
        >
          Send for approval
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
