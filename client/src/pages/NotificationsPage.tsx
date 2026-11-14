import { Button, Card, Spinner } from '../components/ui';
import { NotificationItem } from '../features/notifications/NotificationItem';
import { useMarkRead, useNotificationHistory } from '../features/notifications/use-notifications';

/** Full notification history (FR-150). */
export function NotificationsPage() {
  const { data, isPending, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationHistory();
  const markRead = useMarkRead();
  const items = data?.pages.flatMap((p) => p.notifications) ?? [];
  const unread = data?.pages[0]?.unreadCount ?? 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notifications</h1>
          <p className="text-sm text-slate-600">{unread ? `${unread} unread` : 'All caught up'}</p>
        </div>
        {unread > 0 && (
          <Button variant="secondary" loading={markRead.isPending} onClick={() => markRead.mutate({ all: true })}>
            Mark all as read
          </Button>
        )}
      </div>
      <Card className="p-2">
        {isPending ? (
          <Spinner label="Loading notifications" />
        ) : items.length === 0 ? (
          <p className="py-12 text-center text-sm text-slate-500">No notifications yet. Updates from your events will appear here.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {items.map((n) => (
              <NotificationItem key={n.id} n={n} />
            ))}
          </div>
        )}
      </Card>
      {hasNextPage && (
        <div className="text-center">
          <Button variant="secondary" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            Load older
          </Button>
        </div>
      )}
    </div>
  );
}
