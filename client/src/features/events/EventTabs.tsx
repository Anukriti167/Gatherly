import { useCallback, useRef, type KeyboardEvent } from 'react';
import type { EventDetail } from '@gatherly/shared';
import { useLocation, useSearchParams } from 'react-router';
import { Button } from '../../components/ui';
import { useActivities } from '../activities/use-activities';
import { useGuests } from '../guests/use-guests';
import { useOrganisers } from '../organisers/use-organisers';
import { useProposals } from '../proposals/use-proposals';
import { usePublication } from '../publication/use-publication';

export const EVENT_TABS = ['overview', 'activities', 'guests', 'organisers', 'proposals', 'history'] as const;
export type EventTab = (typeof EVENT_TABS)[number];

const LABEL: Record<EventTab, string> = {
  overview: 'Overview',
  activities: 'Activities',
  guests: 'Guests',
  organisers: 'Organisers',
  proposals: 'Proposals',
  history: 'History',
};

const isTab = (v: string | null): v is EventTab => (EVENT_TABS as readonly string[]).includes(v ?? '');

/**
 * The open tab lives in the URL (?tab=guests) so refresh, back/forward and notification links
 * land on the right tab. Older links using #guests or #proposal-… are understood too.
 */
export function useEventTab(): [EventTab, (t: EventTab) => void] {
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const fromUrl = params.get('tab');
  const tab: EventTab = isTab(fromUrl) ? fromUrl : hash.startsWith('#proposal-') ? 'proposals' : hash === '#guests' ? 'guests' : 'overview';

  const setTab = useCallback(
    (t: EventTab) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (t === 'overview') next.delete('tab');
          else next.set('tab', t);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );
  return [tab, setTab];
}

/** Accessible tab bar with live counts (←/→ to move between tabs). */
export function EventTabs({ event, active, onChange }: { event: EventDetail; active: EventTab; onChange: (t: EventTab) => void }) {
  const { data: activities } = useActivities(event.id);
  const { data: guests } = useGuests(event.id);
  const { data: organisers } = useOrganisers(event.id);
  const { data: proposals } = useProposals(event.id);
  const openProposals = proposals?.filter((p) => p.status === 'OPEN').length ?? 0;
  const refs = useRef<Partial<Record<EventTab, HTMLButtonElement | null>>>({});

  const count: Partial<Record<EventTab, number | undefined>> = {
    activities: activities?.length,
    guests: guests?.length,
    organisers: organisers?.filter((m) => m.status === 'ACTIVE').length,
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = EVENT_TABS.indexOf(active);
    const next = EVENT_TABS[(i + (e.key === 'ArrowRight' ? 1 : EVENT_TABS.length - 1)) % EVENT_TABS.length]!;
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label="Event sections" onKeyDown={onKey} className="-mx-4 flex gap-1 overflow-x-auto border-b border-slate-200 px-4 sm:mx-0 sm:px-0">
      {EVENT_TABS.map((t) => {
        const selected = t === active;
        return (
          <button
            key={t}
            ref={(el) => {
              refs.current[t] = el;
            }}
            id={`tab-${t}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`panel-${t}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t)}
            className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium ${
              selected ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
            }`}
          >
            {LABEL[t]}
            {count[t] !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-xs text-slate-600">{count[t]}</span>}
            {t === 'proposals' && openProposals > 0 && (
              <span className="rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800" title="Open proposals">
                {openProposals} open
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Anything on this event waiting on the signed-in user — visible above every tab. */
export function NeedsYouStrip({ event, onOpen }: { event: EventDetail; onOpen: (t: EventTab) => void }) {
  const { data: publication } = usePublication(event.id);
  const { data: proposals } = useProposals(event.id);
  const waiting = proposals?.filter((p) => p.youCanDecide) ?? [];
  const approvePublishing = publication?.youCanApprove ?? false;
  if (!approvePublishing && waiting.length === 0) return null;

  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-amber-50 px-4 py-3 ring-1 ring-amber-200">
      <p className="text-sm text-amber-900">
        <strong>Needs you:</strong>{' '}
        {[approvePublishing && 'approve publishing this event', ...waiting.map((p) => `approve “${p.title}”`)].filter(Boolean).join(' · ')}
      </p>
      <div className="flex gap-2">
        {approvePublishing && (
          <Button variant="secondary" onClick={() => onOpen('overview')}>
            Review publishing
          </Button>
        )}
        {waiting.length > 0 && (
          <Button variant="secondary" onClick={() => onOpen('proposals')}>
            Review {waiting.length === 1 ? 'proposal' : `${waiting.length} proposals`}
          </Button>
        )}
      </div>
    </div>
  );
}
