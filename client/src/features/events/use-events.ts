import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateEventInput, EventDetail, EventSummary, UpdateEventInput } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';

export const eventKeys = {
  all: ['events'] as const,
  detail: (id: string) => ['events', id] as const,
};

export function useEvents() {
  return useQuery({
    queryKey: eventKeys.all,
    queryFn: async () => (await api.get<{ events: EventSummary[] }>('/events')).events,
    ...live,
  });
}

export function useEvent(id: string) {
  return useQuery({
    queryKey: eventKeys.detail(id),
    queryFn: async () => (await api.get<{ event: EventDetail }>(`/events/${encodeURIComponent(id)}`)).event,
    retry: false,
    ...live,
  });
}

export function useCreateEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateEventInput) => (await api.post<{ event: EventDetail }>('/events', input)).event,
    onSuccess: (event) => {
      qc.setQueryData(eventKeys.detail(event.id), event);
      void qc.invalidateQueries({ queryKey: eventKeys.all, exact: true });
    },
  });
}

export function useUpdateEvent(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { changes: UpdateEventInput; expectedVersion: number }) =>
      (await api.patch<{ event: EventDetail }>(`/events/${encodeURIComponent(id)}`, vars)).event,
    onSuccess: (event) => {
      qc.setQueryData(eventKeys.detail(id), event);
      void qc.invalidateQueries({ queryKey: eventKeys.all, exact: true });
      void qc.invalidateQueries({ queryKey: ['events', id, 'publication'] });
    },
  });
}
