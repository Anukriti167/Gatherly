import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateProposalInput, ProposalView, ReviseProposalInput } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';
import { eventKeys } from '../events/use-events';

const key = (eventId: string) => ['events', eventId, 'proposals'] as const;
const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/proposals`;

export function useProposals(eventId: string) {
  return useQuery({
    queryKey: key(eventId),
    queryFn: async () => (await api.get<{ proposals: ProposalView[] }>(base(eventId))).proposals,
    ...live,
  });
}

/** Applying a proposal can change the event, its guests and its status — refresh everything for it. */
function useProposalMutation<V>(eventId: string, call: (vars: V) => Promise<{ proposal: ProposalView }>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: V) => (await call(vars)).proposal,
    onSuccess: () =>
      Promise.all([qc.invalidateQueries({ queryKey: eventKeys.detail(eventId) }), qc.invalidateQueries({ queryKey: eventKeys.all, exact: true })]),
  });
}

const path = (eventId: string, id: string, action: string) => `${base(eventId)}/${encodeURIComponent(id)}/${action}`;

export const useCreateProposal = (eventId: string) =>
  useProposalMutation(eventId, (input: CreateProposalInput) => api.post(base(eventId), input));

export const useApproveProposal = (eventId: string) =>
  useProposalMutation(eventId, (v: { id: string; expectedVersion: number; comment?: string }) =>
    api.post(path(eventId, v.id, 'approve'), { expectedVersion: v.expectedVersion, comment: v.comment }),
  );

export const useObjectProposal = (eventId: string) =>
  useProposalMutation(eventId, (v: { id: string; expectedVersion: number; comment: string }) =>
    api.post(path(eventId, v.id, 'object'), { expectedVersion: v.expectedVersion, comment: v.comment }),
  );

export const useCommentOnProposal = (eventId: string) =>
  useProposalMutation(eventId, (v: { id: string; body: string }) => api.post(path(eventId, v.id, 'comments'), { body: v.body }));

export const useReviseProposal = (eventId: string) =>
  useProposalMutation(eventId, (v: { id: string } & ReviseProposalInput) => {
    const { id, ...body } = v;
    return api.post(path(eventId, id, 'revise'), body);
  });

export const useWithdrawProposal = (eventId: string) =>
  useProposalMutation(eventId, (id: string) => api.post(path(eventId, id, 'withdraw')));
