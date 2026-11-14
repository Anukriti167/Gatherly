/** One readable line of an event's activity log (FR-197 – FR-199). */
export interface EventHistoryEntry {
  id: string;
  at: string;
  actor: string; // person's name, or "Gatherly" for automatic actions
  /** Short sentence, e.g. "added 12 guests", "approved publishing (version 4)". */
  summary: string;
  /** Optional extra detail lines, e.g. which fields changed. */
  details: string[];
  /** Grouping for icons/filters. */
  category: 'event' | 'activity' | 'guests' | 'organisers' | 'approval' | 'proposal';
}

export interface EventHistoryPage {
  entries: EventHistoryEntry[];
  nextCursor: string | null;
}
