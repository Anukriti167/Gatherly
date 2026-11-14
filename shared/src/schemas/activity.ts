import { z } from 'zod';
import { localDateTimeSchema, timezoneSchema } from './common.js';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be ${max} characters or fewer`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

/** Only http(s) links — blocks javascript:/data: URLs that could run script when clicked. */
export const webUrlSchema = z
  .string()
  .trim()
  .max(2000, 'Link is too long')
  .refine((v) => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'Enter a full link starting with https://');

const optionalUrl = z
  .union([webUrlSchema, z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const optionalLocalDateTime = z
  .union([localDateTimeSchema, z.literal('')])
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

const hexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #AABBCC');

/** Number inputs arrive as strings from forms; '' clears the value. */
const optionalNumber = (schema: z.ZodNumber) =>
  z
    .union([schema, z.string()])
    .transform((v, ctx) => {
      if (typeof v === 'number') return v;
      if (v.trim() === '') return null;
      const n = Number(v);
      const r = schema.safeParse(n);
      if (!r.success) {
        ctx.addIssue({ code: 'custom', message: r.error.issues[0]?.message ?? 'Invalid number' });
        return z.NEVER;
      }
      return r.data;
    })
    .nullable()
    .optional();

// ─── Nested sections, saved together with the activity (single-page editing) ──────────

/** FR-031 — common dietary labels; organisers may also add their own short tags. */
export const DIETARY_TAGS = [
  'vegetarian',
  'vegan',
  'jain',
  'non-vegetarian',
  'gluten-free',
  'contains-nuts',
  'contains-dairy',
  'spicy',
] as const;

export const DIETARY_TAG_LABELS: Record<(typeof DIETARY_TAGS)[number], string> = {
  vegetarian: 'Vegetarian',
  vegan: 'Vegan',
  jain: 'Jain',
  'non-vegetarian': 'Non-vegetarian',
  'gluten-free': 'Gluten-free',
  'contains-nuts': 'Contains nuts',
  'contains-dairy': 'Contains dairy',
  spicy: 'Spicy',
};

export const STANDARD_MENU_CATEGORIES = ['Starters', 'Main Course', 'Desserts', 'Beverages'] as const; // FR-030

const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(30, 'Tags must be 30 characters or fewer')
  .regex(/^[\p{L}\p{N} -]+$/u, 'Tags may contain letters, numbers, spaces and hyphens');

/** FR-024 – FR-026 — times are wall-clock in the activity's timezone. */
export const itineraryItemSchema = z
  .object({
    title: z.string().trim().min(1, 'Give this entry a title').max(200, 'Title must be 200 characters or fewer'),
    description: optionalText(2000),
    startsAt: localDateTimeSchema,
    endsAt: optionalLocalDateTime,
  })
  .refine((v) => !v.endsAt || v.endsAt > v.startsAt, { message: 'End must be after the start', path: ['endsAt'] });
export type ItineraryItemInput = z.input<typeof itineraryItemSchema>;

/** FR-029 – FR-031 */
export const menuItemSchema = z.object({
  name: z.string().trim().min(1, 'Name the dish').max(150, 'Name must be 150 characters or fewer'),
  description: optionalText(500),
  dietaryTags: z
    .array(tagSchema)
    .max(10, 'Up to 10 tags')
    .default([])
    .transform((tags) => [...new Set(tags)]),
});
export const menuCategorySchema = z.object({
  name: z.string().trim().min(1, 'Name the category').max(80, 'Name must be 80 characters or fewer'),
  items: z.array(menuItemSchema).max(100, 'Up to 100 items per category').default([]),
});
export type MenuCategoryInput = z.input<typeof menuCategorySchema>;

/** FR-023 */
export const ACTIVITY_PERSON_ROLES = ['SPEAKER', 'PERFORMER', 'PARTICIPANT'] as const;
export const activityPersonSchema = z.object({
  role: z.enum(ACTIVITY_PERSON_ROLES),
  name: z.string().trim().min(1, 'Enter a name').max(120, 'Name must be 120 characters or fewer'),
  title: optionalText(120),
  bio: optionalText(1000),
});
export type ActivityPersonInput = z.input<typeof activityPersonSchema>;

const activityFields = {
  name: z.string().trim().min(1, 'Activity name is required').max(150, 'Name must be 150 characters or fewer'),
  description: z.string().trim().max(5000, 'Description must be 5000 characters or fewer').default(''),
  timezone: timezoneSchema,
  startsAt: localDateTimeSchema,
  endsAt: localDateTimeSchema,

  // FR-021 — physical venue (entered manually; FR-196) and/or a virtual meeting link (FR-193)
  venueName: optionalText(200),
  venueAddress: optionalText(500),
  venueLatitude: optionalNumber(z.number().min(-90, 'Latitude must be between -90 and 90').max(90, 'Latitude must be between -90 and 90')),
  venueLongitude: optionalNumber(z.number().min(-180, 'Longitude must be between -180 and 180').max(180, 'Longitude must be between -180 and 180')),
  virtualMeetingUrl: optionalUrl,

  capacity: optionalNumber(z.number().int('Capacity must be a whole number').min(1, 'Capacity must be at least 1').max(100_000, 'Capacity is too large')), // FR-022
  rsvpDeadline: optionalLocalDateTime, // FR-119, wall-clock in the activity timezone

  dressCode: optionalText(1000), // FR-032
  themeDescription: optionalText(2000), // FR-033
  themeColors: z.array(hexColour).max(8, 'Up to 8 colours').nullable().optional(),
  instructions: optionalText(5000), // FR-034

  // FR-035 — hide sections that aren't relevant
  showPeople: z.boolean().optional(),
  showItinerary: z.boolean().optional(),
  showMenu: z.boolean().optional(),
  showDressCode: z.boolean().optional(),
  showTheme: z.boolean().optional(),
  showInstructions: z.boolean().optional(),

  // Nested sections. When present, the list REPLACES the activity's current entries
  // (array order = display order); when omitted, existing entries are left untouched.
  itinerary: z.array(itineraryItemSchema).max(100, 'Up to 100 itinerary entries').optional(),
  menu: z.array(menuCategorySchema).max(20, 'Up to 20 menu categories').optional(),
  people: z.array(activityPersonSchema).max(50, 'Up to 50 people').optional(),
};

type TimeFields = { startsAt?: string; endsAt?: string; rsvpDeadline?: string | null };

const checkTimes = (v: TimeFields, ctx: z.RefinementCtx) => {
  if (v.startsAt && v.endsAt && v.endsAt <= v.startsAt) {
    ctx.addIssue({ code: 'custom', message: 'End must be after the start', path: ['endsAt'] });
  }
  if (v.rsvpDeadline && v.startsAt && v.rsvpDeadline > v.startsAt) {
    ctx.addIssue({ code: 'custom', message: 'RSVP deadline must be before the activity starts', path: ['rsvpDeadline'] });
  }
};

const checkCoordinates = (v: { venueLatitude?: number | null; venueLongitude?: number | null }, ctx: z.RefinementCtx) => {
  const hasLat = v.venueLatitude !== undefined && v.venueLatitude !== null;
  const hasLng = v.venueLongitude !== undefined && v.venueLongitude !== null;
  if (hasLat !== hasLng) ctx.addIssue({ code: 'custom', message: 'Enter both latitude and longitude, or neither', path: ['venueLongitude'] });
};

/** FR-012, FR-019 – FR-022, FR-032 – FR-035 */
export const createActivitySchema = z.object(activityFields).superRefine(checkTimes).superRefine(checkCoordinates);
export type CreateActivityInput = z.input<typeof createActivitySchema>;
export type CreateActivityData = z.output<typeof createActivitySchema>;

/** FR-036 — each activity is edited independently. Times + timezone must be sent together. */
export const updateActivitySchema = z
  .object({ ...activityFields, description: activityFields.description.optional() })
  .partial()
  .superRefine(checkTimes)
  .superRefine(checkCoordinates)
  .refine(
    (v) => [v.startsAt, v.endsAt, v.timezone].every((x) => x === undefined) || [v.startsAt, v.endsAt, v.timezone].every((x) => x !== undefined),
    { message: 'Send startsAt, endsAt and timezone together', path: ['startsAt'] },
  );
export type UpdateActivityInput = z.input<typeof updateActivitySchema>;
export type UpdateActivityData = z.output<typeof updateActivitySchema>;
