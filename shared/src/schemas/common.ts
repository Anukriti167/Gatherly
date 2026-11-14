import { z } from 'zod';
import { isValidTimeZone, LOCAL_DATE_TIME_PATTERN } from '../time.js';

/** Email: trimmed, lower-cased, RFC-length-limited. Used everywhere an email is accepted. */
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

/** Person / display name. */
export const nameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name must be 100 characters or fewer');

/**
 * Optional phone number (FR-005, FR-073). Free-form but restricted to digits and
 * common separators; empty string is normalised to null so it can be cleared.
 */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .max(30, 'Phone number is too long')
  .regex(/^\+?[0-9 ()\-.]*$/, 'Phone number may contain only digits, spaces and + ( ) - .')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional();

/** IANA timezone identifier, validated against the runtime's Intl database. */
export const timezoneSchema = z.string().trim().min(1, 'Timezone is required').max(64).refine(isValidTimeZone, 'Unknown timezone');

/** Wall-clock date-time entered by an organiser, interpreted in the accompanying timezone. */
export const localDateTimeSchema = z
  .string()
  .regex(LOCAL_DATE_TIME_PATTERN, 'Use the format YYYY-MM-DDTHH:mm');

export const idSchema = z.string().min(1).max(64);
