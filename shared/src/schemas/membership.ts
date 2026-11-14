import { z } from 'zod';
import { emailSchema } from './common.js';

/** FR-062 — the owner invites an existing Gatherly user by email. */
export const inviteCoAdminSchema = z.object({ email: emailSchema });
export type InviteCoAdminInput = z.input<typeof inviteCoAdminSchema>;

export type MembershipStatus = 'INVITED' | 'ACTIVE' | 'DECLINED' | 'REMOVED';

/** An organiser of an event, as shown to the other organisers. */
export interface EventMember {
  id: string; // membership id
  userId: string;
  name: string;
  email: string;
  role: 'OWNER' | 'CO_ADMIN';
  status: MembershipStatus;
  invitedAt: string;
  respondedAt: string | null;
  invitedByName: string | null;
  isYou: boolean;
}

/** A pending co-admin invitation addressed to the current user (shown on their dashboard). */
export interface CoAdminInvitation {
  membershipId: string;
  eventId: string;
  eventName: string;
  eventStartsAt: string;
  eventTimezone: string;
  invitedByName: string | null;
  invitedAt: string;
}
