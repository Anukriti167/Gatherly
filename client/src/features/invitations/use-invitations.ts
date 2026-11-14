import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuestInvitationView } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';

const key = (eventId: string) => ['events', eventId, 'invitations'] as const;
const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/invitations`;

export function useInvitations(eventId: string, enabled = true) {
  return useQuery({
    queryKey: key(eventId),
    queryFn: async () => (await api.get<{ invitations: GuestInvitationView[] }>(base(eventId))).invitations,
    enabled,
    ...live,
  });
}

function useInvitationAction<V, R>(eventId: string, call: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: call, onSuccess: () => qc.invalidateQueries({ queryKey: key(eventId) }) });
}

/** guestIds omitted → everyone not yet invited. */
export const useSendInvitations = (eventId: string) =>
  useInvitationAction(eventId, (guestIds?: string[]) => api.post<{ queued: number }>(`${base(eventId)}/send`, guestIds ? { guestIds } : {}));

export const useRevokeInvitation = (eventId: string) =>
  useInvitationAction(eventId, (guestId: string) => api.post<void>(`${base(eventId)}/${encodeURIComponent(guestId)}/revoke`));

export const useRetryInvitation = (eventId: string) =>
  useInvitationAction(eventId, (guestId: string) => api.post<void>(`${base(eventId)}/${encodeURIComponent(guestId)}/retry`));
