import { describe, expect, it } from 'vitest';
import { buildIcs, icsEscape } from '../../src/lib/ics.ts';

describe('icsEscape', () => {
  it('escapes RFC 5545 special characters', () => {
    expect(icsEscape('Dinner; drinks, dance\\party\nAll night')).toBe('Dinner\\; drinks\\, dance\\\\party\\nAll night');
  });
});

describe('buildIcs', () => {
  const ics = buildIcs({
    calendarName: 'Asha & Rohan Wedding',
    timezone: 'Asia/Kolkata',
    now: new Date('2026-11-15T00:00:00Z'),
    events: [
      {
        uid: 'act1@gatherly',
        start: new Date('2027-02-12T13:30:00Z'),
        end: new Date('2027-02-12T18:00:00Z'),
        summary: 'Sangeet · Asha & Rohan Wedding',
        location: 'Taj Lands End, Bandstand, Mumbai',
        description: 'A very long description '.repeat(10),
        url: 'https://gatherly.example/my-event',
      },
    ],
  });

  it('uses CRLF line endings and the required envelope', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
  });

  it('writes exact UTC instants and keeps the event timezone (FR-191)', () => {
    expect(ics).toContain('DTSTART:20270212T133000Z'); // 19:00 IST
    expect(ics).toContain('DTEND:20270212T180000Z');
    expect(ics).toContain('X-WR-TIMEZONE:Asia/Kolkata');
    expect(ics).toContain('LOCATION:Taj Lands End\\, Bandstand\\, Mumbai');
  });

  it('folds long lines to 75 octets', () => {
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(ics).toContain('\r\n '); // continuation lines
  });
});
