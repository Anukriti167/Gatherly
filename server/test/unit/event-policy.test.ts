import { describe, expect, it } from 'vitest';
import {
  ACTIVITY_STATUSES,
  can,
  editModeFor,
  EVENT_STATUSES,
  EVENT_TYPES,
  MEMBERSHIP_ROLES,
  PLANNING_PATHS,
  type EventAction,
  type EventStatus,
} from '@gatherly/shared';
import { ActivityStatus, EventStatus as DbEventStatus, EventType, MembershipRole, PlanningPath } from '../../src/generated/prisma/enums.ts';

describe('shared enums match the database schema', () => {
  it.each([
    ['EventStatus', EVENT_STATUSES, DbEventStatus],
    ['EventType', EVENT_TYPES, EventType],
    ['PlanningPath', PLANNING_PATHS, PlanningPath],
    ['MembershipRole', MEMBERSHIP_ROLES, MembershipRole],
    ['ActivityStatus', ACTIVITY_STATUSES, ActivityStatus],
  ])('%s', (_name, shared, prisma) => {
    expect([...shared].sort()).toEqual(Object.values(prisma).sort());
  });
});

describe('editModeFor', () => {
  it.each<[EventStatus, string]>([
    ['DRAFT', 'direct'], // FR-013, FR-221
    ['PENDING_APPROVAL', 'direct-invalidates-approvals'], // FR-228
    ['PUBLISHED', 'proposal'], // all published changes need unanimous approval
    ['COMPLETED', 'locked'],
    ['CANCELLED', 'locked'],
  ])('%s → %s', (status, mode) => {
    expect(editModeFor(status)).toBe(mode);
  });
});

describe('can()', () => {
  it('denies everything to non-members (FR-067, FR-200)', () => {
    for (const status of EVENT_STATUSES) {
      expect(can(null, 'event.view', status)).toBe(false);
      expect(can(undefined, 'event.edit', status)).toBe(false);
    }
  });

  it('lets owner and co-admin edit drafts directly (FR-221)', () => {
    expect(can('OWNER', 'event.edit', 'DRAFT')).toBe(true);
    expect(can('CO_ADMIN', 'event.edit', 'DRAFT')).toBe(true);
  });

  it('forces published changes through proposals', () => {
    expect(can('OWNER', 'event.edit', 'PUBLISHED')).toBe(false);
    expect(can('OWNER', 'proposal.create', 'PUBLISHED')).toBe(true);
    expect(can('CO_ADMIN', 'proposal.decide', 'PUBLISHED')).toBe(true);
    expect(can('OWNER', 'proposal.create', 'DRAFT')).toBe(false);
  });

  it('reserves co-admin management and ownership transfer for the owner (FR-064)', () => {
    const ownerOnly: EventAction[] = ['coadmins.manage', 'ownership.transfer'];
    for (const action of ownerOnly) {
      expect(can('OWNER', action, 'DRAFT')).toBe(true);
      expect(can('CO_ADMIN', action, 'DRAFT')).toBe(false);
      expect(can('CO_ADMIN', action, 'PUBLISHED')).toBe(false);
    }
  });

  it('blocks invitations until the event is published (FR-226)', () => {
    expect(can('OWNER', 'invitations.send', 'DRAFT')).toBe(false);
    expect(can('OWNER', 'invitations.send', 'PENDING_APPROVAL')).toBe(false);
    expect(can('OWNER', 'invitations.send', 'PUBLISHED')).toBe(true);
  });

  it('keeps day-to-day actions direct once published', () => {
    for (const action of ['announcements.publish', 'suggestions.respond', 'photos.moderate', 'invitations.revoke'] as const) {
      expect(can('CO_ADMIN', action, 'PUBLISHED')).toBe(true);
    }
  });

  it('allows cover changes without approval in any non-cancelled status (FR-046, FR-153)', () => {
    expect(can('CO_ADMIN', 'cover.change', 'PUBLISHED')).toBe(true);
    expect(can('CO_ADMIN', 'cover.change', 'PENDING_APPROVAL')).toBe(true);
    expect(can('OWNER', 'cover.change', 'CANCELLED')).toBe(false);
  });

  it('only allows publication actions in the right state (FR-222 – FR-227)', () => {
    expect(can('CO_ADMIN', 'publication.submit', 'DRAFT')).toBe(true);
    expect(can('CO_ADMIN', 'publication.submit', 'PUBLISHED')).toBe(false);
    expect(can('CO_ADMIN', 'publication.decide', 'PENDING_APPROVAL')).toBe(true);
    expect(can('CO_ADMIN', 'publication.decide', 'DRAFT')).toBe(false);
  });

  it('locks completed and cancelled events against edits', () => {
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      expect(can('OWNER', 'event.edit', status)).toBe(false);
      expect(can('OWNER', 'proposal.create', status)).toBe(false);
    }
  });
});
