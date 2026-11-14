import { useState } from 'react';
import type { EventDetail } from '@gatherly/shared';
import { useLocation } from 'react-router';
import { Card } from '../../components/ui';
import { useGuests } from '../guests/use-guests';
import { ProposalCard } from './ProposalCard';
import { useProposals } from './use-proposals';

const RECENT_CLOSED = 2;

/**
 * Change proposals for a published event. Open proposals are shown in full; finished ones are
 * limited to the latest two (the bell / notifications page carries the full history).
 */
export function ProposalsSection({ event }: { event: EventDetail }) {
  const { data: proposals = [] } = useProposals(event.id);
  const { data: guests = [] } = useGuests(event.id);
  const { hash } = useLocation();
  const [showAll, setShowAll] = useState(false);
  const open = proposals.filter((p) => p.status === 'OPEN');
  const closed = proposals.filter((p) => p.status !== 'OPEN');
  if (proposals.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-semibold">Change proposals</h2>
        <p className="mt-1 text-sm text-slate-500">
          {event.status === 'PUBLISHED'
            ? 'No proposals yet. Use “Propose removal” on a guest, or the buttons on the Overview tab, to propose a change.'
            : 'Proposals are used once the event is published — every change then needs all organisers to approve.'}
        </p>
      </Card>
    );
  }

  // A notification may link to an older, closed proposal — make sure it's visible.
  const linked = closed.findIndex((p) => hash === `#proposal-${p.id}`);
  const visibleClosed = showAll || linked >= RECENT_CLOSED ? closed : closed.slice(0, RECENT_CLOSED);

  return (
    <Card className={open.length ? 'ring-2 ring-amber-300' : undefined}>
      <h2 className="text-lg font-semibold">Change proposals</h2>
      <p className="text-sm text-slate-500">Changes to a published event need every organiser's approval. They're applied automatically once everyone agrees.</p>

      <div className="mt-4 space-y-3">
        {open.length === 0 && <p className="text-sm text-slate-500">No open proposals.</p>}
        {open.map((p) => (
          <ProposalCard key={p.id} eventId={event.id} p={p} guests={guests} />
        ))}
      </div>

      {closed.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">Recently decided</h3>
          <div className="mt-3 space-y-3">
            {visibleClosed.map((p) => (
              <ProposalCard key={p.id} eventId={event.id} p={p} guests={guests} />
            ))}
          </div>
          {closed.length > RECENT_CLOSED && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-3 text-sm font-medium text-brand-700 hover:underline">
              {showAll ? 'Show fewer' : `Show all ${closed.length} past proposals`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
