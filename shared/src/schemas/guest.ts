import { z } from 'zod';
import { emailSchema, nameSchema, optionalPhoneSchema } from './common.js';

const activityIds = z.array(z.string().min(1).max(64)).max(200).default([]);

/** FR-068, FR-073, FR-076, FR-077 */
export const createGuestSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  phone: optionalPhoneSchema,
  allActivities: z.boolean().default(false),
  activityIds,
});
export type CreateGuestInput = z.input<typeof createGuestSchema>;
export type CreateGuestData = z.output<typeof createGuestSchema>;

/** FR-075, FR-078 */
export const updateGuestSchema = z
  .object({ name: nameSchema, email: emailSchema, phone: optionalPhoneSchema, allActivities: z.boolean(), activityIds: activityIds.optional() })
  .partial();
export type UpdateGuestInput = z.input<typeof updateGuestSchema>;
export type UpdateGuestData = z.output<typeof updateGuestSchema>;

export const GUEST_IMPORT_MAX_ROWS = 2000;

/**
 * FR-069 – FR-071, FR-074 — CSV text. `allActivities` / `activityIds` are the DEFAULT used for rows
 * whose Activities cell is empty; rows can name their own activities ("All" or "Sangeet; Reception").
 */
export const importGuestsSchema = z.object({
  csv: z.string().min(1, 'The file is empty').max(1_000_000, 'The file is too large (max 1 MB)'),
  mode: z.enum(['preview', 'commit']),
  allActivities: z.boolean().default(false),
  activityIds,
});
export type ImportGuestsInput = z.input<typeof importGuestsSchema>;

/** A guest as seen by organisers (includes contact details — never sent to other guests, FR-201). */
export interface GuestView {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  allActivities: boolean;
  /** Explicit assignments; when `allActivities` is true every activity applies. */
  activityIds: string[];
  createdAt: string;
}

export type ImportRowStatus = 'ok' | 'invalid' | 'duplicate-in-file' | 'already-on-list';

export interface ImportRowResult {
  line: number; // 1-based line in the file (header = 1)
  name: string;
  email: string;
  phone: string | null;
  /** Activities from the row's own Activities cell; null = cell empty → the import's default applies. */
  invitedTo: { all: boolean; activityIds: string[]; names: string[] } | null;
  status: ImportRowStatus;
  errors: string[];
}

export interface ImportReport {
  mode: 'preview' | 'commit';
  columns: { name: number; email: number; phone: number | null; activities: number | null };
  rows: ImportRowResult[];
  counts: Record<ImportRowStatus, number>;
  /** Rows (that will be added) relying on the default activities because their cell is empty. */
  rowsUsingDefault: number;
  imported: number;
}

/** Words accepted in the Activities column meaning "every activity, including future ones". */
export const ALL_ACTIVITIES_WORDS = ['all', 'all activities', 'everything', '*'];

/** Separators accepted between activity names in one cell: ; , | or a line break. */
export const ACTIVITY_LIST_SEPARATOR = /[;,|\n]/;

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

/**
 * Downloadable guest-list template with the headings the importer recognises. Example rows use the
 * event's real activity names, so organisers can see exactly what to type.
 */
export function guestImportTemplate(activityNames: string[] = []): string {
  const some = activityNames.slice(0, 2).join('; ') || 'Name of an activity';
  const rows = [
    ['Name', 'Email', 'Phone', 'Activities'],
    ['Asha Rao', 'asha@example.com', '+91 98765 43210', 'All'],
    ['Rohan Mehta', 'rohan@example.com', '', some],
    ['Priya Shah', 'priya@example.com', '', ''],
  ];
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
