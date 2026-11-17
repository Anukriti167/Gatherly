import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GuestActivity, GuestEventView } from '@gatherly/shared';
import { api, ApiError } from '../../lib/api';
import { live } from '../../lib/live';

export const guestKey = ['guest', 'event'] as const;
const guestMicrositeKey = ['guest', 'microsite'] as const;

export type GuestMicrositeActivityResponse = {
  view: GuestEventView;
  activity: GuestActivity;
};

/** The guest's personal event view; `null` when there's no valid guest session. */
export function useGuestView() {
  return useQuery({
    queryKey: guestKey,
    queryFn: async (): Promise<GuestEventView | null> => {
      try {
        return (await api.get<{ view: GuestEventView }>('/guest/event')).view;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    ...live,
  });
}

/** Event microsite data is scoped by the server to the active guest session. */
export function useGuestMicrositeEvent(eventSlug: string) {
  return useQuery({
    queryKey: [...guestMicrositeKey, eventSlug],
    queryFn: async () => (await api.get<{ view: GuestEventView }>(`/guest/events/${encodeURIComponent(eventSlug)}`)).view,
    enabled: Boolean(eventSlug),
    retry: false,
    ...live,
  });
}

/** Activity endpoint also enforces assignment access on the server. */
export function useGuestMicrositeActivity(eventSlug: string, activitySlug: string) {
  return useQuery({
    queryKey: [...guestMicrositeKey, eventSlug, activitySlug],
    queryFn: () => api.get<GuestMicrositeActivityResponse>(`/guest/events/${encodeURIComponent(eventSlug)}/activities/${encodeURIComponent(activitySlug)}`),
    enabled: Boolean(eventSlug && activitySlug),
    retry: false,
    ...live,
  });
}

/** Exchanges the invitation link token for a guest session (FR-088, FR-092). */
export function useOpenInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.post<void>('/guest/session', { token }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: guestKey });
      qc.invalidateQueries({ queryKey: guestMicrositeKey });
    },
  });
}

export function useGuestLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<void>('/guest/logout'),
    onSettled: () => {
      qc.setQueryData(guestKey, null);
      qc.removeQueries({ queryKey: guestMicrositeKey });
    },
  });
}

/** FR-006 — open your guest page from the dashboard (signed in, verified email). */
export function useOpenAsGuest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) => api.post<void>('/guest/session/from-account', { eventId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: guestKey });
      qc.invalidateQueries({ queryKey: guestMicrositeKey });
    },
  });
}

/** FR-109 — answer for one activity; refresh both legacy and microsite pages. */
export function useRsvp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { activityId: string; status: 'CONFIRMED' | 'DECLINED' }) =>
      (await api.put<{ view: GuestEventView }>(`/guest/rsvps/${encodeURIComponent(vars.activityId)}`, { status: vars.status })).view,
    onSuccess: (view) => {
      qc.setQueryData(guestKey, view);
      qc.invalidateQueries({ queryKey: guestMicrositeKey });
    },
  });
}

/** FR-190 — calendar file download links (the guest cookie authorises them). */
export const calendarUrl = (activityId?: string) => `/api/v1/guest/calendar.ics${activityId ? `?activityId=${encodeURIComponent(activityId)}` : ''}`;
