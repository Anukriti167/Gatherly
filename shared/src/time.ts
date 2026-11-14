/**
 * Timezone helpers with no dependencies (Intl only).
 *
 * Organisers enter wall-clock times in the event/activity timezone ("2026-12-20T19:00" in
 * Asia/Kolkata). We store exact UTC instants and keep the IANA timezone alongside, so guests,
 * calendar exports (FR-191) and DST changes all render correctly.
 */

/** Wall-clock date-time without a zone, minute precision: YYYY-MM-DDTHH:mm */
export const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    partsFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock components of an instant in a timezone. */
function zonedParts(instant: Date, timeZone: string) {
  const out: Record<string, number> = {};
  for (const p of partsFormatter(timeZone).formatToParts(instant)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `timeZone` from UTC at `instant`, in milliseconds (e.g. +5:30 → 19_800_000). */
export function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = instant.getTime() - instant.getUTCMilliseconds();
  return asUtc - truncated;
}

/** Instant → "YYYY-MM-DDTHH:mm" in the given timezone. */
export function utcToZonedLocal(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * "YYYY-MM-DDTHH:mm" in `timeZone` → UTC instant.
 * Returns null for malformed input, unknown zones, or wall-clock times that don't exist
 * (skipped by a daylight-saving jump). Ambiguous times (clocks going back) resolve to the
 * earlier instant.
 */
export function zonedLocalToUtc(local: string, timeZone: string): Date | null {
  const m = LOCAL_DATE_TIME_PATTERN.exec(local);
  if (!m || !isValidTimeZone(timeZone)) return null;
  const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(naive)) return null;

  // Two passes handle instants near DST transitions.
  const offset1 = timeZoneOffsetMs(new Date(naive), timeZone);
  let candidate = naive - offset1;
  const offset2 = timeZoneOffsetMs(new Date(candidate), timeZone);
  if (offset2 !== offset1) {
    const alt = naive - offset2;
    // Prefer the earlier instant if both are valid renderings of `local`.
    candidate = utcToZonedLocal(new Date(alt), timeZone) === local ? Math.min(alt, candidate) : candidate;
  }
  const result = new Date(candidate);
  // Round-trip check rejects invalid dates (Feb 30) and DST-gap times.
  return utcToZonedLocal(result, timeZone) === local ? result : null;
}
