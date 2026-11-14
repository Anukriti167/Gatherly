import { describe, expect, it } from 'vitest';
import { createEventSchema, updateEventSchema } from '@gatherly/shared';

const valid = {
  name: '  Asha & Rohan’s Wedding ',
  eventType: 'WEDDING',
  timezone: 'Asia/Kolkata',
  startsAt: '2026-12-18T10:00',
  endsAt: '2026-12-20T23:00',
};

describe('createEventSchema', () => {
  it('accepts a minimal valid event and fills defaults', () => {
    const r = createEventSchema.parse(valid);
    expect(r.name).toBe('Asha & Rohan’s Wedding');
    expect(r.description).toBe('');
  });

  it('rejects an end before the start, on the endsAt field', () => {
    const r = createEventSchema.safeParse({ ...valid, endsAt: '2026-12-17T10:00' });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.path).toEqual(['endsAt']);
  });

  it('rejects unknown event types and timezones', () => {
    expect(createEventSchema.safeParse({ ...valid, eventType: 'RAVE' }).success).toBe(false);
    expect(createEventSchema.safeParse({ ...valid, timezone: 'Mars/Base' }).success).toBe(false);
  });

  it('requires a name', () => {
    expect(createEventSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });
});

describe('updateEventSchema', () => {
  it('accepts partial updates', () => {
    expect(updateEventSchema.parse({ description: 'New text' })).toEqual({ description: 'New text' });
  });

  it('requires times and timezone to be sent together', () => {
    expect(updateEventSchema.safeParse({ startsAt: '2026-12-18T10:00' }).success).toBe(false);
    expect(
      updateEventSchema.safeParse({ startsAt: '2026-12-18T10:00', endsAt: '2026-12-18T12:00', timezone: 'Asia/Kolkata' }).success,
    ).toBe(true);
  });

  it('clears optional text with an empty string', () => {
    expect(updateEventSchema.parse({ instructions: '' }).instructions).toBeNull();
  });
});
