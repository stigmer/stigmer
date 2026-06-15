// Shared table renderer for list/collection views. Mirrors the column model of
// the Go CLI's pkg/display table (dynamic widths, dash separator, 3-space gap).
//
// Wave 1 implements the non-adaptive path: columns size to their widest cell.
// Terminal-width adaptation and ANSI-aware measurement can be layered on later
// without changing the call sites.

const COLUMN_GAP = "   ";

/** Render a table from headers and rows. Returns "" when there are no rows. */
export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  if (rows.length === 0) return "";

  const widths = headers.map((header, column) => {
    let width = header.length;
    for (const row of rows) {
      const cell = row[column] ?? "";
      if (cell.length > width) width = cell.length;
    }
    return width;
  });

  const renderRow = (cells: readonly string[]): string =>
    headers
      .map((_, column) => padRight(cells[column] ?? "", widths[column]))
      .join(COLUMN_GAP)
      .replace(/ +$/, "");

  const lines: string[] = [];
  lines.push(renderRow(headers));
  lines.push(widths.map((width) => "-".repeat(width)).join(COLUMN_GAP));
  for (const row of rows) {
    lines.push(renderRow(row));
  }
  return lines.join("\n") + "\n";
}

/** Standardized empty-state message for list commands. */
export function renderEmpty(resourceName: string, query?: string): string {
  const middle =
    query !== undefined && query !== ""
      ? `No ${resourceName} found matching '${query}'`
      : `No ${resourceName} found`;
  return `\n${middle}\n\n`;
}

function padRight(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}
