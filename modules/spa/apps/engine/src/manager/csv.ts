/**
 * CSV for exports and reports (C23, S62). A cell that a spreadsheet would read as a formula (it starts with `=`, `+`, `-`
 * or `@`, or with a tab or carriage return) gets a leading apostrophe so it is read as text.
 */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One CSV line, CRLF-terminated. */
export const csvLine = (cells: readonly (string | number | null | undefined)[]): string =>
  `${cells.map(csvCell).join(",")}\r\n`;
