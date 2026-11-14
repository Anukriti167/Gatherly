import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateGuestInput, GuestView, ImportGuestsInput, ImportReport, RsvpOverview, UpdateGuestInput } from '@gatherly/shared';
import { api } from '../../lib/api';
import { live } from '../../lib/live';

const key = (eventId: string) => ['events', eventId, 'guests'] as const;
const base = (eventId: string) => `/events/${encodeURIComponent(eventId)}/guests`;

export function useGuests(eventId: string) {
  return useQuery({
    queryKey: key(eventId),
    queryFn: async () => (await api.get<{ guests: GuestView[] }>(base(eventId))).guests,
    ...live,
  });
}

/** Guest changes don't touch the event's version or approvals — only the guest list refreshes. */
function useInvalidate(eventId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: key(eventId) });
}

export function useAddGuest(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: async (guest: CreateGuestInput) => (await api.post<{ guest: GuestView }>(base(eventId), { guest })).guest,
    onSuccess: invalidate,
  });
}

export function useUpdateGuest(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: async (vars: { id: string; changes: UpdateGuestInput }) =>
      (await api.patch<{ guest: GuestView }>(`${base(eventId)}/${encodeURIComponent(vars.id)}`, { changes: vars.changes })).guest,
    onSuccess: invalidate,
  });
}

export function useRemoveGuest(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`${base(eventId)}/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  });
}

export function useImportGuests(eventId: string) {
  const invalidate = useInvalidate(eventId);
  return useMutation({
    mutationFn: async (vars: ImportGuestsInput) => (await api.post<{ report: ImportReport }>(`${base(eventId)}/import`, vars)).report,
    onSuccess: (report) => (report.mode === 'commit' ? invalidate() : undefined),
  });
}

/** FR-115, FR-116 — RSVP counts per activity and each guest's answers. */
export function useRsvpOverview(eventId: string) {
  return useQuery({
    queryKey: ['events', eventId, 'rsvps'],
    queryFn: () => api.get<RsvpOverview>(`/events/${encodeURIComponent(eventId)}/rsvps`),
    ...live,
  });
}
