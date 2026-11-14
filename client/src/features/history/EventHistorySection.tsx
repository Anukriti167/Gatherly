import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { EventDetail, EventHistoryEntry, EventHistoryPage } from '@gatherly/shared';
import { Button, Card, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { timeAgo } from '../notifications/NotificationItem';

type Category = EventHistoryEntry['category'];

const ICON: Record<Category, string> = {
  event: '📅',
  activity: '🗓️',
  guests: '👥',
  organisers: '🤝',
  approval: '🗳️',
  proposal: '📝',
};

const FILTERS: { key: Category | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'guests', label: 'Guests' },
  { key: 'activity', label: 'Activities' },
  { key: 'approval', label: 'Publishing' },
  { key: 'proposal', label: 'Proposals' },
  { key: 'organisers', label: 'Organisers' },
  { key: 'event', label: 'Event' },
];

const fullDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );
const dayOf = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));

function useEventHistory(eventId: string, category: Category | 'all') {
  return useInfiniteQuery({
    queryKey: ['events', eventId, 'history', category],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: '30' });
      if (pageParam) qs.set('before', pageParam);
      if (category !== 'all') qs.set('category', category);
      return api.get<EventHistoryPage>(`/events/${encodeURIComponent(eventId)}/history?${qs}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    ...live,
  });
}

/** History tab: the event's activity log, filterable and grouped by day (FR-197 – FR-199). */
export function EventHistoryTab({ event }: { event: EventDetail }) {
  const [filter, setFilter] = useState<Category | 'all'>('all');
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useEventHistory(event.id, filter);
  const entries = data?.pages.flatMap((p) => p.entries) ?? [];

  // Group consecutive entries by calendar day for easier scanning.
  const days: { day: string; items: EventHistoryEntry[] }[] = [];
  for (const e of entries) {
    const day = dayOf(e.at);
    if (days.at(-1)?.day === day) days.at(-1)!.items.push(e);
    else days.push({ day, items: [e] });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">History</h2>
          <p className="text-sm text-slate-500">Everything that happened on this event — who did what, and when.</p>
        </div>
      </div>

      <div role="group" aria-label="Filter history" className="mt-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-full px-3 py-1 text-sm ring-1 ${filter === f.key ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {isPending ? (
          <Spinner label="Loading history" />
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">Nothing here yet.</p>
        ) : (
          <div className="space-y-6">
            {days.map(({ day, items }) => (
              <section key={day}>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{day}</h3>
                <ol className="space-y-3">
                  {items.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-sm ring-1 ring-slate-200">
                        {ICON[e.category]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-slate-800">
                          <strong className={e.actor === 'Gatherly' ? 'text-brand-700' : undefined}>{e.actor}</strong> {e.summary}
                        </p>
                        {e.details.filter(Boolean).map((d) => (
                          <p key={d} className="text-xs text-slate-500">
                            {d}
                          </p>
                        ))}
                      </div>
                      <time dateTime={e.at} title={fullDate(e.at)} className="shrink-0 text-xs text-slate-400">
                        {timeAgo(e.at)}
                      </time>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
        {hasNextPage && (
          <div className="mt-6 text-center">
            <Button variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
              Show older
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
