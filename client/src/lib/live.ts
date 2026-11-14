/**
 * "Live" data: shared screens (event, activities, organisers, approvals, invitations) re-check
 * the server every 15 s while the tab is visible, and immediately when the user returns to the
 * tab, so changes made by other organisers appear without a manual refresh.
 * Hidden tabs don't poll (TanStack Query pauses intervals in the background by default).
 */
export const LIVE_REFRESH_MS = 15_000;

export const live = { refetchInterval: LIVE_REFRESH_MS, refetchOnWindowFocus: true } as const;
