import { z } from 'zod';

/**
 * Change proposals for published events (FR-132 – FR-153). A proposal carries a list of typed
 * changes. Step 1 supports guest removal, unpublishing (product request) and cancelling the event
 * (FR-152); event-detail and activity changes are added next.
 */
export const proposalChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('REMOVE_GUESTS'), guestIds: z.array(z.string().min(1).max(64)).min(1, 'Choose at least one guest').max(500) }),
  z.object({ type: z.literal('UNPUBLISH') }),
  z.object({ type: z.literal('CANCEL_EVENT'), reason: z.string().trim().max(1000).optional() }),
  // Finish a live event early (it completes automatically when its end time passes).
  z.object({ type: z.literal('COMPLETE_EVENT') }),
]);
export type ProposalChange = z.infer<typeof proposalChangeSchema>;
export type ProposalChangeType = ProposalChange['type'];

const changesSchema = z
  .array(proposalChangeSchema)
  .min(1, 'A proposal needs at least one change')
  .max(20)
  .superRefine((changes, ctx) => {
    const types = changes.map((c) => c.type);
    if (new Set(types).size !== types.length) ctx.addIssue({ code: 'custom', message: 'Each kind of change can appear only once' });
    if (types.filter((t) => t === 'UNPUBLISH' || t === 'CANCEL_EVENT' || t === 'COMPLETE_EVENT').length > 1) {
      ctx.addIssue({ code: 'custom', message: 'Propose only one of: unpublishing, cancelling or completing the event' });
    }
  });

const title = z.string().trim().min(1, 'Give the proposal a short title').max(150);
const description = z.string().trim().min(1, 'Explain the change for the other organisers').max(2000);

export const createProposalSchema = z.object({ title, description, changes: changesSchema });
export type CreateProposalInput = z.input<typeof createProposalSchema>;

/** FR-142 — the proposer revises; a new version is created and earlier approvals no longer count. */
export const reviseProposalSchema = z.object({ expectedVersion: z.number().int().positive(), title: title.optional(), description, changes: changesSchema });
export type ReviseProposalInput = z.input<typeof reviseProposalSchema>;

export const approveProposalSchema = z.object({ expectedVersion: z.number().int().positive(), comment: z.string().trim().max(1000).optional() });
/** FR-138 — objections need a reason; they don't reject the proposal (FR-139). */
export const objectProposalSchema = z.object({
  expectedVersion: z.number().int().positive(),
  comment: z.string().trim().min(1, 'Say what you disagree with').max(1000),
});
export const proposalCommentSchema = z.object({ body: z.string().trim().min(1, 'Write a comment').max(2000) });

// ─── Views ───────────────────────────────────────────────────────────────────

export type ProposalStatus = 'OPEN' | 'APPLIED' | 'WITHDRAWN' | 'CLOSED';

/** A change, enriched for display. */
export type ProposalChangeView =
  | { type: 'REMOVE_GUESTS'; guests: { id: string; name: string; email: string; stillOnList: boolean }[] }
  | { type: 'UNPUBLISH' }
  | { type: 'CANCEL_EVENT'; reason: string | null }
  | { type: 'COMPLETE_EVENT' };

export interface ProposalApproverView {
  userId: string;
  name: string;
  state: 'APPROVED' | 'OBJECTED' | 'PENDING';
  comment: string | null;
  decidedAt: string | null;
  isYou: boolean;
}

export type ProposalTimelineItem =
  | { kind: 'revision'; at: string; by: string; version: number; description: string }
  | { kind: 'decision'; at: string; by: string; version: number; decision: 'APPROVE' | 'OBJECT'; comment: string | null }
  | { kind: 'comment'; at: string; by: string; body: string; isYou: boolean }
  | { kind: 'closed'; at: string; status: ProposalStatus; reason: string | null };

export interface ProposalView {
  id: string;
  eventId: string;
  title: string;
  status: ProposalStatus;
  version: number;
  proposer: { id: string; name: string };
  description: string;
  changes: ProposalChangeView[];
  approvers: ProposalApproverView[];
  approvedCount: number;
  requiredCount: number;
  objectionCount: number;
  youAreProposer: boolean;
  /** Required approver who hasn't approved the current version yet. */
  youCanDecide: boolean;
  createdAt: string;
  closedAt: string | null;
  closedReason: string | null;
  /** FR-149 — revisions, approvals, objections and discussion in order. */
  timeline: ProposalTimelineItem[];
}
