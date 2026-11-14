import { guestImportTemplate } from '@gatherly/shared';

/**
 * Saves text as a file in the browser. CSVs get a UTF-8 byte-order mark so Excel shows
 * non-English names (e.g. "अनुकृति", "José") correctly.
 */
export function downloadTextFile(filename: string, text: string, mime = 'text/csv'): void {
  const bom = mime === 'text/csv' ? '\uFEFF' : '';
  const url = URL.createObjectURL(new Blob([bom + text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Guest import template (FR-069, FR-074), with this event's activity names in the examples. */
export function downloadGuestTemplate(activityNames: string[]): void {
  downloadTextFile('gatherly-guest-list-template.csv', guestImportTemplate(activityNames));
}
