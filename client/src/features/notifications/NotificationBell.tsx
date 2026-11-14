import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { NotificationItem } from './NotificationItem';
import { useLatestNotifications, useMarkRead } from './use-notifications';

/** Bell with unread count; opens a panel with the latest updates (FR-150). */
export function NotificationBell() {
  const { data } = useLatestNotifications(8);
  const markRead = useMarkRead();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = data?.unreadCount ?? 0;

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100"
      >
        <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
          <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0a3 3 0 1 1-6 0m6 0H9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 z-40 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between px-2 py-1">
            <h2 className="text-sm font-semibold">Notifications</h2>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate({ all: true })} className="text-xs font-medium text-brand-700 hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-auto">
            {data?.notifications.length ? (
              data.notifications.map((n) => <NotificationItem key={n.id} n={n} onOpen={() => setOpen(false)} />)
            ) : (
              <p className="px-3 py-8 text-center text-sm text-slate-500">You're all caught up.</p>
            )}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="mt-1 block rounded-lg px-3 py-2 text-center text-sm font-medium text-brand-700 hover:bg-slate-50">
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
