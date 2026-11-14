import { EVENT_TYPE_LABELS, type EventStatus, type EventType } from '@gatherly/shared';

/** "Fri, 12 Feb 2027, 10:00 am" style, rendered in the event's own timezone. */
export function formatDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Compact date range: "12 – 14 Feb 2027" or "12 Feb 2027" when on one day. */
export function formatDateRange(startIso: string, endIso: string, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat(undefined, { timeZone, day: 'numeric', month: 'short', year: 'numeric' });
  const a = fmt.format(new Date(startIso));
  const b = fmt.format(new Date(endIso));
  return a === b ? a : fmt.formatRange(new Date(startIso), new Date(endIso));
}

/** Short zone label, e.g. "GMT+5:30" / "IST". */
export function timeZoneLabel(timeZone: string, at = new Date()): string {
  const part = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? timeZone;
}

export function eventTypeLabel(type: EventType, custom: string | null): string {
  return type === 'OTHER' && custom ? custom : EVENT_TYPE_LABELS[type];
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending approval',
  PUBLISHED: 'Published',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const STATUS_TONE: Record<EventStatus, 'slate' | 'amber' | 'green' | 'brand' | 'red'> = {
  DRAFT: 'slate',
  PENDING_APPROVAL: 'amber',
  PUBLISHED: 'green',
  COMPLETED: 'brand',
  CANCELLED: 'red',
};

/** All IANA zones the browser knows, with the user's own zone first. */
export function timeZoneOptions(): { value: string; label: string }[] {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [local];
  const ordered = [local, ...zones.filter((z) => z !== local)];
  return ordered.map((z) => ({ value: z, label: `${z.replaceAll('_', ' ')} (${timeZoneLabel(z)})` }));
}

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
