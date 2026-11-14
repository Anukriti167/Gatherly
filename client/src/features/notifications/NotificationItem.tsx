import type { NotificationView } from '@gatherly/shared';
import { useNavigate } from 'react-router';
import { useMarkRead } from './use-notifications';

/** "5 min ago", "3 h ago", "2 Nov" */
export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(new Date(iso));
}

const ICON: Record<string, string> = {
  'proposal.created': '🗳️',
  'proposal.revised': '🗳️',
  'proposal.objection': '✋',
  'proposal.comment': '💬',
  'proposal.withdrawn': '↩️',
  'proposal.applied': '✅',
  'publication.requested': '🗳️',
  'publication.published': '🎉',
  'publication.changes_requested': '✏️',
  'guests.changed': '👥',
  'coadmin.invited': '🤝',
  'coadmin.removed': '🚪',
  'event.completed': '🏁',
};

/** One notification row; clicking marks it read and opens its link. */
export function NotificationItem({ n, onOpen }: { n: NotificationView; onOpen?: () => void }) {
  const navigate = useNavigate();
  const markRead = useMarkRead();
  return (
    <button
      type="button"
      onClick={() => {
        if (!n.read) markRead.mutate({ ids: [n.id] });
        onOpen?.();
        navigate(n.url);
      }}
      className={`flex w-full gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-slate-50 ${n.read ? '' : 'bg-brand-50/60'}`}
    >
      <span aria-hidden className="mt-0.5 text-lg leading-none">
        {ICON[n.kind] ?? '🔔'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span className={`text-sm ${n.read ? 'text-slate-700' : 'font-semibold text-slate-900'}`}>{n.title}</span>
          {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Unread" />}
        </span>
        <span className="line-clamp-2 block text-xs text-slate-600">{n.body}</span>
        <span className="mt-0.5 block text-xs text-slate-400">
          {n.eventName && <>{n.eventName} · </>}
          {timeAgo(n.createdAt)}
        </span>
      </span>
    </button>
  );
}
