/**
 * Domain enums shared by client and server. These MUST match the Prisma enums in
 * server/prisma/schema.prisma — a unit test fails if they drift apart.
 */
export const EVENT_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'COMPLETED', 'CANCELLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_TYPES = [
  'WEDDING',
  'BIRTHDAY',
  'ANNIVERSARY',
  'CONFERENCE',
  'SUMMIT',
  'WORKSHOP',
  'MEETUP',
  'PARTY',
  'OTHER',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  WEDDING: 'Wedding',
  BIRTHDAY: 'Birthday',
  ANNIVERSARY: 'Anniversary',
  CONFERENCE: 'Conference',
  SUMMIT: 'Summit',
  WORKSHOP: 'Workshop',
  MEETUP: 'Meetup',
  PARTY: 'Party',
  OTHER: 'Other occasion',
};

export const PLANNING_PATHS = ['FORMAL', 'INFORMAL'] as const;
export type PlanningPath = (typeof PLANNING_PATHS)[number];

export const MEMBERSHIP_ROLES = ['OWNER', 'CO_ADMIN'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export const ACTIVITY_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
