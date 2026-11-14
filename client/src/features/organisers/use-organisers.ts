import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CoAdminInvitation, EventMember } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { eventKeys } from '../events/use-events';

const membersKey = (eventId: string) => ['events', eventId, 'members'] as const;
const invitationsKey = ['invitations'] as const;
const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/members`;

export function useOrganisers(eventId: string) {
  return useQuery({
    queryKey: membersKey(eventId),
    queryFn: async () => (await api.get<{ members: EventMember[] }>(base(eventId))).members,
    ...live,
  });
}

export function useInviteCoAdmin(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (email: string) => (await api.post<{ member: EventMember }>(base(eventId), { email })).member,
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(eventId) }),
  });
}

export function useRemoveOrganiser(eventId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => api.delete<void>(`${base(eventId)}/${encodeURIComponent(membershipId)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: membersKey(eventId) }),
  });
}

/** Co-admin invitations addressed to me (dashboard). */
export function useMyInvitations() {
  return useQuery({
    queryKey: invitationsKey,
    queryFn: async () => (await api.get<{ invitations: CoAdminInvitation[] }>('/invitations')).invitations,
    ...live,
  });
}

export function useRespondToInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, accept }: { eventId: string; accept: boolean }) =>
      api.post<void>(`${base(eventId)}/me/${accept ? 'accept' : 'decline'}`),
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: invitationsKey }), qc.invalidateQueries({ queryKey: eventKeys.all, exact: true })]),
  });
}
