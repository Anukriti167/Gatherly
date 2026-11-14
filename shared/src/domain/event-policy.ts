import type { EventStatus, MembershipRole } from './enums.js';

/**
 * Event-level authorisation rules — the single source of truth for "who may do what, and when".
 * The server enforces these on every request; the client uses them only to hide controls.
 *
 * Decisions recorded with the product owner (14 Nov 2026):
 * - Draft: owner and co-admins edit freely (FR-013, FR-221).
 * - Pending Approval: edits are allowed but invalidate all approvals and start a new round (FR-228).
 * - Published: every change to event/activity details goes through a change proposal needing
 *   unanimous approval. Invitations, announcements, suggestion replies and photo moderation stay direct.
 * - Guests: adding and editing (incl. activity assignments) is direct at any time; removing a guest
 *   after publishing needs a change proposal. Guest changes aren't part of the approved content, so
 *   they don't bump the event version, and every change is emailed to the other organisers.
 * - Cover images are presentation-only and never need approval (FR-046, FR-153).
 * - Only the owner manages co-admins or transfers ownership (FR-063 – FR-065).
 */

export type EventAction =
  | 'event.view' // view the admin side of the event
  | 'event.edit' // change event / activity details directly
  | 'guests.manage' // add guests and edit them (incl. activity assignments)
  | 'guests.remove' // remove guests (after publishing this needs a change proposal)
  | 'publication.submit'
  | 'publication.decide'
  | 'proposal.create'
  | 'proposal.decide'
  | 'coadmins.manage'
  | 'ownership.transfer'
  | 'cover.change'
  | 'invitations.send'
  | 'invitations.revoke'
  | 'announcements.publish'
  | 'suggestions.respond'
  | 'photos.upload'
  | 'photos.moderate'
  | 'audit.view';

/** How a detail edit is applied in each status. */
export type EditMode = 'direct' | 'direct-invalidates-approvals' | 'proposal' | 'locked';

export function editModeFor(status: EventStatus): EditMode {
  switch (status) {
    case 'DRAFT':
      return 'direct';
    case 'PENDING_APPROVAL':
      return 'direct-invalidates-approvals';
    case 'PUBLISHED':
      return 'proposal';
    case 'COMPLETED':
    case 'CANCELLED':
      return 'locked';
  }
}

type Rule = { roles: readonly MembershipRole[]; statuses: readonly EventStatus[] };

const ADMINS = ['OWNER', 'CO_ADMIN'] as const;
const OWNER_ONLY = ['OWNER'] as const;
const ALL: readonly EventStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'COMPLETED', 'CANCELLED'];
const LIVE: readonly EventStatus[] = ['PUBLISHED', 'COMPLETED'];
const NOT_CANCELLED: readonly EventStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED', 'COMPLETED'];

const RULES: Record<EventAction, Rule> = {
  'event.view': { roles: ADMINS, statuses: ALL },
  'event.edit': { roles: ADMINS, statuses: ['DRAFT', 'PENDING_APPROVAL'] },
  // Guests: adding/editing is direct at any time; removal cuts off access, so after publishing it
  // needs everyone's approval (decided with the product owner, 14 Nov 2026).
  'guests.manage': { roles: ADMINS, statuses: ['DRAFT', 'PENDING_APPROVAL', 'PUBLISHED'] },
  'guests.remove': { roles: ADMINS, statuses: ['DRAFT', 'PENDING_APPROVAL'] },
  'publication.submit': { roles: ADMINS, statuses: ['DRAFT'] },
  'publication.decide': { roles: ADMINS, statuses: ['PENDING_APPROVAL'] },
  'proposal.create': { roles: ADMINS, statuses: ['PUBLISHED'] },
  'proposal.decide': { roles: ADMINS, statuses: ['PUBLISHED'] },
  'coadmins.manage': { roles: OWNER_ONLY, statuses: NOT_CANCELLED },
  'ownership.transfer': { roles: OWNER_ONLY, statuses: NOT_CANCELLED },
  'cover.change': { roles: ADMINS, statuses: NOT_CANCELLED },
  // FR-226: no guest invitations until the event is published.
  'invitations.send': { roles: ADMINS, statuses: ['PUBLISHED'] },
  'invitations.revoke': { roles: ADMINS, statuses: ['PUBLISHED', 'COMPLETED', 'CANCELLED'] },
  'announcements.publish': { roles: ADMINS, statuses: LIVE },
  'suggestions.respond': { roles: ADMINS, statuses: LIVE },
  'photos.upload': { roles: ADMINS, statuses: NOT_CANCELLED },
  'photos.moderate': { roles: ADMINS, statuses: LIVE },
  'audit.view': { roles: ADMINS, statuses: ALL },
};

export const EVENT_ACTIONS = Object.keys(RULES) as EventAction[];

/** Every action `role` may take on an event in `status` (used to drive the UI). */
export function allowedActions(role: MembershipRole | null | undefined, status: EventStatus): EventAction[] {
  return EVENT_ACTIONS.filter((a) => can(role, a, status));
}

/**
 * Whether a member with `role` may perform `action` on an event in `status`.
 * `role` is null for non-members. Approver-specific checks (e.g. "is this user in the
 * approver snapshot?") are made by the approval engine on top of this.
 */
export function can(role: MembershipRole | null | undefined, action: EventAction, status: EventStatus): boolean {
  if (!role) return false;
  const rule = RULES[action];
  return rule.roles.includes(role) && rule.statuses.includes(status);
}
