import { z } from 'zod';
import { EVENT_TYPES, PLANNING_PATHS } from '../domain/enums.js';
import { emailSchema, localDateTimeSchema, timezoneSchema } from './common.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const eventFields = {
  name: z.string().trim().min(1, 'Event name is required').max(150, 'Event name must be 150 characters or fewer'),
  description: z.string().trim().max(5000, 'Description must be 5000 characters or fewer').default(''),
  eventType: z.enum(EVENT_TYPES, { error: 'Choose an event type' }),
  customTypeLabel: optionalText(50),
  // FR-047/FR-049: optional — '' (form "skip") is normalised to null.
  planningPath: z
    .union([z.enum(PLANNING_PATHS), z.literal('')])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  timezone: timezoneSchema,
  /** Wall-clock times in `timezone`. */
  startsAt: localDateTimeSchema,
  endsAt: localDateTimeSchema,
};

const endAfterStart = (v: { startsAt?: string; endsAt?: string }) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt;
const endAfterStartError = { message: 'End must be after the start', path: ['endsAt'] };

/** FR-008, FR-009, FR-014 — a new event always starts as a Draft. */
export const createEventSchema = z.object(eventFields).refine(endAfterStart, endAfterStartError);
export type CreateEventInput = z.input<typeof createEventSchema>;
/** Validated, normalised create payload (what the server works with). */
export type CreateEventData = z.output<typeof createEventSchema>;

/** Partial update of event details (FR-016). Times and timezone must be sent together. */
export const updateEventSchema = z
  .object({
    ...eventFields,
    description: eventFields.description.optional(),
    instructions: optionalText(5000),
    organiserContactName: optionalText(100),
    organiserContactEmail: emailSchema.nullable().optional(),
    organiserContactPhone: optionalText(30),
    guestUploadsEnabled: z.boolean().optional(),
  })
  .partial()
  .refine(endAfterStart, endAfterStartError)
  .refine(
    (v) => [v.startsAt, v.endsAt, v.timezone].every((x) => x === undefined) || [v.startsAt, v.endsAt, v.timezone].every((x) => x !== undefined),
    { message: 'Send startsAt, endsAt and timezone together', path: ['startsAt'] },
  );
export type UpdateEventInput = z.input<typeof updateEventSchema>;
export type UpdateEventData = z.output<typeof updateEventSchema>;
