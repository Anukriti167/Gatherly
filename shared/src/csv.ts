/**
 * Minimal RFC 4180 CSV parser (no dependency): quoted fields, escaped quotes (""), commas and
 * line breaks inside quotes, CRLF/LF endings, and a leading UTF-8 BOM (Excel's "CSV UTF-8").
 * Returns rows of trimmed cells; fully empty rows are dropped.
 */
export function parseCsv(text: string): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const endCell = () => {
    row.push(cell.trim());
    cell = '';
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') endCell();
    else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) endRow();
  return rows;
}
