import { z } from 'zod';
import type { EventStatus } from '../domain/enums.js';

export type ApproverState = 'APPROVED' | 'CHANGES_REQUESTED' | 'PENDING';

export interface RoundApproverView {
  userId: string;
  name: string;
  state: ApproverState;
  decidedAt: string | null;
  comment: string | null;
  isYou: boolean;
}

export interface ApprovalRoundView {
  id: string;
  status: 'OPEN' | 'APPROVED' | 'CHANGES_REQUESTED' | 'SUPERSEDED' | 'WITHDRAWN';
  eventVersion: number;
  initiatedByName: string;
  reason: string | null;
  createdAt: string;
  closedAt: string | null;
  approvers: RoundApproverView[];
  approvedCount: number;
  requiredCount: number;
}

/** Everything the event page needs to show the publication workflow (FR-222 – FR-230). */
export interface PublicationState {
  eventStatus: EventStatus;
  eventVersion: number;
  /** The open round, or the most recent one if none is open. */
  current: ApprovalRoundView | null;
  /** True when the signed-in user is a required approver who hasn't approved this version yet. */
  youCanApprove: boolean;
  /** Older rounds, newest first (FR-229 history). */
  history: ApprovalRoundView[];
}

export const submitForApprovalSchema = z.object({ expectedVersion: z.number().int().positive() });
export const approveSchema = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().trim().max(1000).optional(),
});
export const requestChangesSchema = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().trim().min(1, 'Tell the other organisers what should change').max(1000),
});
