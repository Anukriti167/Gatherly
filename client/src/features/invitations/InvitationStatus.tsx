import type { GuestInvitationView } from '@gatherly/shared';
import { timeAgo } from '../notifications/NotificationItem';

/** Small status line for a guest's invitation (FR-083, FR-090, FR-160). */
export function InvitationStatus({ inv }: { inv: GuestInvitationView | undefined }) {
  if (!inv || inv.status === 'NOT_INVITED') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Not invited yet</span>;
  if (inv.status === 'REVOKED') return <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700">Invitation revoked</span>;
  if (inv.delivery === 'FAILED') {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700" title={inv.deliveryError ?? undefined}>
        Email failed
      </span>
    );
  }
  if (inv.lastAccessedAt) return <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-700">Opened {timeAgo(inv.lastAccessedAt)}</span>;
  if (inv.delivery === 'QUEUED') return <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800">Sending…</span>;
  return <span className="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-700">Invited{inv.lastSentAt ? ` ${timeAgo(inv.lastSentAt)}` : ''}</span>;
}
