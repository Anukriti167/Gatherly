/**
 * Minimal iCalendar (RFC 5545) writer for "Add to calendar" (FR-190, FR-191).
 * Times are exact UTC instants (…Z), so every calendar app shows the right local time; the event's
 * IANA timezone is included as X-WR-TIMEZONE and in the description.
 */
export interface IcsEvent {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
}

const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** Escapes text values: backslash, semicolon, comma and newlines. */
export function icsEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines longer than 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

export function buildIcs(opts: { calendarName: string; timezone: string; events: IcsEvent[]; now?: Date }): string {
  const stamp = utc(opts.now ?? new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gatherly//Event Planner//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(opts.calendarName)}`,
    `X-WR-TIMEZONE:${opts.timezone}`,
  ];
  for (const e of opts.events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${utc(e.start)}`,
      `DTEND:${utc(e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      ...(e.location ? [`LOCATION:${icsEscape(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${icsEscape(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
