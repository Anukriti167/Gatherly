import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicationState } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { eventKeys } from '../events/use-events';

const key = (eventId: string) => ['events', eventId, 'publication'] as const;
const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/publication`;

export function usePublication(eventId: string) {
  return useQuery({
    queryKey: key(eventId),
    queryFn: async () => (await api.get<{ publication: PublicationState }>(base(eventId))).publication,
    ...live,
  });
}

/** Any publication action changes the event's status, so refresh the event and lists too. */
function usePublicationAction<V>(eventId: string, path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: V) => (await api.post<{ publication: PublicationState }>(`${base(eventId)}/${path}`, body)).publication,
    onSuccess: (state) => {
      qc.setQueryData(key(eventId), state);
      return Promise.all([
        qc.invalidateQueries({ queryKey: eventKeys.detail(eventId), exact: true }),
        qc.invalidateQueries({ queryKey: eventKeys.all, exact: true }),
      ]);
    },
  });
}

export const useSubmitForApproval = (eventId: string) => usePublicationAction<{ expectedVersion: number }>(eventId, 'submit');
export const useApprove = (eventId: string) => usePublicationAction<{ expectedVersion: number; comment?: string }>(eventId, 'approve');
export const useRequestChanges = (eventId: string) => usePublicationAction<{ expectedVersion: number; comment: string }>(eventId, 'request-changes');
