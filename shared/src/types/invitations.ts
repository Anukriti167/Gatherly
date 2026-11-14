import { z } from 'zod';
import type { ActivityDetail } from './activities.js';
import type { EventStatus } from '../domain/enums.js';

/** Invitation state per guest, for organisers (FR-083, FR-090, FR-160). */
export interface GuestInvitationView {
  guestId: string;
  status: 'NOT_INVITED' | 'INVITED' | 'REVOKED';
  /** Delivery of the most recent invitation email. */
  delivery: 'QUEUED' | 'SENT' | 'FAILED' | null;
  deliveryError: string | null;
  sendCount: number;
  lastSentAt: string | null;
  /** When the guest last opened their link — shows who has seen the invitation. */
  lastAccessedAt: string | null;
}

/** guestIds omitted → invite everyone who hasn't been invited yet. */
export const sendInvitationsSchema = z.object({
  guestIds: z.array(z.string().min(1).max(64)).min(1).max(2000).optional(),
});
export type SendInvitationsInput = z.input<typeof sendInvitationsSchema>;

export const guestSessionSchema = z.object({ token: z.string().min(20).max(128) });

// ─── Guest website (FR-094 – FR-108) ─────────────────────────────────────────

export type RsvpStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED';

/** An activity as a guest sees it: hidden sections are removed, RSVP state included. */
export interface GuestActivity extends ActivityDetail {
  rsvp: RsvpStatus;
  rsvpOpen: boolean;
  /** True when the activity is full and the guest hasn't confirmed yet. */
  full: boolean;
}

export interface GuestItineraryEntry {
  activityId: string;
  activityName: string;
  title: string;
  description: string | null;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
}

export interface GuestEventView {
  /** 'AVAILABLE' normally; 'UPDATING' while unpublished (organisers are making changes). */
  availability: 'AVAILABLE' | 'UPDATING';
  guest: { name: string };
  event: {
    id: string;
    name: string;
    description: string;
    eventTypeLabel: string;
    status: EventStatus;
    startsAt: string;
    endsAt: string;
    timezone: string;
    instructions: string | null;
    organiserContact: { name: string | null; email: string | null; phone: string | null } | null;
  };
  /** Only the activities this guest is invited to (FR-096), chronological. */
  activities: GuestActivity[];
  /** The guest's personal timeline across their activities (FR-097). */
  itinerary: GuestItineraryEntry[];
}

// ─── RSVP (FR-109 – FR-119) ──────────────────────────────────────────────────

/** A guest's answer for one activity. (PENDING = not answered; guests can't set it back.) */
export const rsvpSchema = z.object({ status: z.enum(['CONFIRMED', 'DECLINED']) });
export type RsvpInput = z.input<typeof rsvpSchema>;

/** Organiser view of RSVPs (FR-115, FR-116). */
export interface ActivityRsvpSummary {
  activityId: string;
  invited: number;
  confirmed: number;
  declined: number;
  pending: number;
  capacity: number | null;
}

export interface RsvpOverview {
  activities: ActivityRsvpSummary[];
  /** guestId → activityId → answer (only answered ones; missing = pending). */
  answers: Record<string, Record<string, 'CONFIRMED' | 'DECLINED'>>;
}
