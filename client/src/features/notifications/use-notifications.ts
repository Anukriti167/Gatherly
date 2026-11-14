import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActionItem, NotificationsPage } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';

export const notificationKeys = { all: ['notifications'] as const, actionItems: ['action-items'] as const };

/** Latest notifications + unread count, for the bell. */
export function useLatestNotifications(limit = 8) {
  return useQuery({
    queryKey: [...notificationKeys.all, 'latest', limit],
    queryFn: () => api.get<NotificationsPage>(`/me/notifications?limit=${limit}`),
    ...live,
  });
}

/** Full history with "load more", for the notifications page. */
export function useNotificationHistory() {
  return useInfiniteQuery({
    queryKey: [...notificationKeys.all, 'history'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<NotificationsPage>(`/me/notifications?limit=30${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.nextCursor,
    ...live,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[] } | { all: true }) => api.post<{ updated: number }>('/me/notifications/read', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }),
  });
}

/** Things waiting on me across all events ("Needs your attention"). */
export function useActionItems() {
  return useQuery({
    queryKey: notificationKeys.actionItems,
    queryFn: async () => (await api.get<{ items: ActionItem[] }>('/me/action-items')).items,
    ...live,
  });
}
