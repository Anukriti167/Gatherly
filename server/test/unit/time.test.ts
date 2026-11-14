import { describe, expect, it } from 'vitest';
import { isValidTimeZone, timeZoneOffsetMs, utcToZonedLocal, zonedLocalToUtc } from '@gatherly/shared';

describe('zonedLocalToUtc', () => {
  it('converts India time (UTC+5:30, no DST)', () => {
    expect(zonedLocalToUtc('2026-12-20T19:00', 'Asia/Kolkata')?.toISOString()).toBe('2026-12-20T13:30:00.000Z');
  });

  it('handles summer and winter offsets for New York', () => {
    expect(zonedLocalToUtc('2026-07-04T12:00', 'America/New_York')?.toISOString()).toBe('2026-07-04T16:00:00.000Z');
    expect(zonedLocalToUtc('2026-12-25T12:00', 'America/New_York')?.toISOString()).toBe('2026-12-25T17:00:00.000Z');
  });

  it('returns null for a time skipped by daylight saving (spring forward)', () => {
    // 8 March 2026, New York clocks jump from 02:00 to 03:00.
    expect(zonedLocalToUtc('2026-03-08T02:30', 'America/New_York')).toBeNull();
  });

  it('resolves an ambiguous time (fall back) to the earlier instant', () => {
    // 1 November 2026, 01:30 happens twice in New York; first is EDT (UTC-4).
    expect(zonedLocalToUtc('2026-11-01T01:30', 'America/New_York')?.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('rejects impossible dates, bad formats and unknown zones', () => {
    expect(zonedLocalToUtc('2026-02-30T10:00', 'Asia/Kolkata')).toBeNull();
    expect(zonedLocalToUtc('2026-12-20 19:00', 'Asia/Kolkata')).toBeNull();
    expect(zonedLocalToUtc('2026-12-20T19:00', 'Mars/Olympus')).toBeNull();
  });

  it('round-trips with utcToZonedLocal', () => {
    for (const tz of ['Asia/Kolkata', 'Europe/London', 'Australia/Sydney', 'UTC']) {
      const utc = zonedLocalToUtc('2026-06-15T08:45', tz)!;
      expect(utcToZonedLocal(utc, tz)).toBe('2026-06-15T08:45');
    }
  });
});

describe('timezone helpers', () => {
  it('computes offsets', () => {
    expect(timeZoneOffsetMs(new Date('2026-01-01T00:00:00Z'), 'Asia/Kolkata')).toBe(5.5 * 3600_000);
    expect(timeZoneOffsetMs(new Date('2026-01-01T00:00:00Z'), 'UTC')).toBe(0);
  });

  it('validates IANA zone names', () => {
    expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
  });
});
