import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ActivityDetail, CreateActivityInput, UpdateActivityInput } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { eventKeys } from '../events/use-events';

const activityKeys = {
  list: (eventId: string) => ['events', eventId, 'activities'] as const,
};

const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/activities`;

export function useActivities(eventId: string) {
  return useQuery({
    queryKey: activityKeys.list(eventId),
    queryFn: async () => (await api.get<{ activities: ActivityDetail[] }>(base(eventId))).activities,
    ...live,
  });
}

/** Every activity change bumps the event version, so the event is refetched too. */
function useInvalidate(eventId: string) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: activityKeys.list(eventId) }),
      // Prefix match: the event itself plus its approval status (edits while pending reset approvals).
      qc.invalidateQueries({ queryKey: eventKeys.detail(eventId) }),
    ]);
}

export function useCreateActivity(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: async (vars: { activity: CreateActivityInput; expectedVersion: number }) =>
      (await api.post<{ activity: ActivityDetail }>(base(eventId), vars)).activity,
    onSuccess: invalidate,
  });
}

export function useUpdateActivity(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: async (vars: { id: string; changes: UpdateActivityInput; expectedVersion: number }) =>
      (
        await api.patch<{ activity: ActivityDetail }>(`${base(eventId)}/${encodeURIComponent(vars.id)}`, {
          changes: vars.changes,
          expectedVersion: vars.expectedVersion,
        })
      ).activity,
    onSuccess: invalidate,
  });
}

export function useDeleteActivity(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (vars: { id: string; expectedVersion: number }) =>
      api.delete<void>(`${base(eventId)}/${encodeURIComponent(vars.id)}?expectedVersion=${vars.expectedVersion}`),
    onSuccess: invalidate,
  });
}
