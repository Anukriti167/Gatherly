import { z } from 'zod';

/** An in-app notification for the signed-in user (FR-150, FR-160). */
export interface NotificationView {
  id: string;
  eventId: string | null;
  eventName: string | null;
  kind: string;
  title: string;
  body: string;
  /** In-app path, e.g. /events/abc#proposal-xyz */
  url: string;
  createdAt: string;
  read: boolean;
}

export interface NotificationsPage {
  notifications: NotificationView[];
  unreadCount: number;
  /** Pass as `before` to load older notifications; null when there are no more. */
  nextCursor: string | null;
}

/** Something waiting on the signed-in user (computed, not stored). */
export interface ActionItem {
  kind: 'PUBLICATION_APPROVAL' | 'PROPOSAL_DECISION';
  eventId: string;
  eventName: string;
  title: string;
  url: string;
  since: string;
}

export const markNotificationsReadSchema = z.union([
  z.object({ ids: z.array(z.string().min(1).max(64)).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);
export type MarkNotificationsReadInput = z.input<typeof markNotificationsReadSchema>;
