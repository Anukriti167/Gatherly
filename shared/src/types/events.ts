import type { EventAction } from '../domain/event-policy.js';
import type { EventStatus, EventType, MembershipRole, PlanningPath } from '../domain/enums.js';

/** Dashboard grouping (FR-007, FR-185). Derived from time, not stored. */
export type Timeframe = 'upcoming' | 'ongoing' | 'completed' | 'cancelled';

export interface EventSummary {
  id: string;
  /** Human-readable URL identifier; nullable only during the staged backfill. */
  slug: string | null;
  name: string;
  eventType: EventType;
  customTypeLabel: string | null;
  status: EventStatus;
  timezone: string;
  /** ISO instants (UTC). */
  startsAt: string;
  endsAt: string;
  /** Your relationship to the event: organiser role, or GUEST for events you're invited to (FR-006). */
  role: MembershipRole | 'GUEST';
  timeframe: Timeframe;
}

export interface EventDetail extends Omit<EventSummary, 'role'> {
  role: MembershipRole;
  description: string;
  planningPath: PlanningPath | null;
  version: number;
  /** Wall-clock values in `timezone`, ready for <input type="datetime-local">. */
  startsAtLocal: string;
  endsAtLocal: string;
  instructions: string | null;
  organiserContactName: string | null;
  organiserContactEmail: string | null;
  organiserContactPhone: string | null;
  guestUploadsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** Actions the current user may take right now — for showing/hiding controls only. */
  allowedActions: EventAction[];
}

/**
 * Dashboard grouping (FR-007, FR-185). Status wins over the clock: cancelled events only ever
 * appear under "Cancelled" (FR-181 keeps them out of completed history), and an event completed
 * early is "completed" even before its end date. Otherwise it follows the event's dates.
 */
export function timeframeOf(startsAt: Date, endsAt: Date, now: Date = new Date(), status?: EventStatus): Timeframe {
  if (status === 'CANCELLED') return 'cancelled';
  if (status === 'COMPLETED') return 'completed';
  if (endsAt.getTime() <= now.getTime()) return 'completed';
  if (startsAt.getTime() <= now.getTime()) return 'ongoing';
  return 'upcoming';
}
