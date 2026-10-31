// Shared table renderer for list/collection views: columns sized to their
// widest cell, a dash separator, a 3-space gap, and a fit to the terminal.
//
// A table fits the terminal it is drawn on: when a row is wider than the
// terminal, the columns the caller names as free text (a description, a
// subject, a display name) lose width, widest first, down to a floor, and
// their cells end in "…". Ids and slugs are never named, so what a person
// copies into the next command is never cut. Piped output has no width and
// nothing is cut, so a script reads every cell whole. The width is the
// caller's to give (`terminalWidth` reads it from the stream it writes to),
// which keeps this renderer a pure function of its input.
//
// Widths are measured in terminal columns with `string-width`, so a wide
// character or an emoji counts as the two columns it fills, and a cut falls
// between graphemes, never inside a surrogate pair or a combined character.

import stringWidth from "string-width";

const COLUMN_GAP = "   ";

/** The narrowest a shrinking column becomes: enough to recognize a description or a name. */
export const SHRINK_FLOOR = 12;

const ELLIPSIS = "…";

// Grapheme boundaries, so a cut never splits what a person sees as one character.
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** How a table fits the terminal it is drawn on. */
export interface TableOptions {
  /** The terminal's width in columns; undefined (piped output) cuts nothing. */
  readonly width?: number;
  /**
   * The headers of the columns that may lose width when a row is too wide:
   * free text only, never an id or a slug a person copies.
   */
  readonly shrink?: readonly string[];
}

/** The part of an output stream that says whether it is a terminal and how wide. */
export interface TerminalStream {
  readonly isTTY?: boolean;
  readonly columns?: number;
}

/** The width a table written to `stream` fits: the terminal's columns, or undefined when piped. */
export function terminalWidth(
  stream: TerminalStream = process.stdout,
): number | undefined {
  if (stream.isTTY !== true) return undefined;
  const columns = stream.columns;
  return columns !== undefined && columns > 0 ? columns : undefined;
}

/** Render a table from headers and rows. Returns "" when there are no rows. */
export function renderTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  options: TableOptions = {},
): string {
  if (rows.length === 0) return "";

  const natural = headers.map((header, column) => {
    let width = stringWidth(header);
    for (const row of rows) {
      const cell = stringWidth(row[column] ?? "");
      if (cell > width) width = cell;
    }
    return width;
  });
  const widths = fitWidths(headers, natural, options);

  const renderRow = (cells: readonly string[]): string =>
    headers
      .map((_, column) =>
        padRight(cut(cells[column] ?? "", widths[column]), widths[column]),
      )
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

// The column widths that fit `width`: while the row is too wide, the widest
// shrinkable column above its floor gives up one column (the leftmost of
// equals), so wide columns come down to their neighbours before any of them
// goes further. A column's floor is SHRINK_FLOOR or its header, whichever is
// wider, so a header is never cut. When every shrinkable column sits at its
// floor the row stays wider than the terminal and the terminal wraps it.
function fitWidths(
  headers: readonly string[],
  natural: readonly number[],
  options: TableOptions,
): number[] {
  const widths = [...natural];
  const { width, shrink = [] } = options;
  if (width === undefined) return widths;
  const floors = headers.map((header, column) =>
    shrink.includes(header)
      ? Math.max(SHRINK_FLOOR, stringWidth(header))
      : natural[column],
  );
  let over =
    widths.reduce((sum, columnWidth) => sum + columnWidth, 0) +
    COLUMN_GAP.length * (widths.length - 1) -
    width;
  while (over > 0) {
    let widest = -1;
    for (let column = 0; column < widths.length; column++) {
      if (
        widths[column] > floors[column] &&
        (widest === -1 || widths[column] > widths[widest])
      )
        widest = column;
    }
    if (widest === -1) break;
    widths[widest] -= 1;
    over -= 1;
  }
  return widths;
}

// `text` cut to `width` columns: whole graphemes while they fit beside the
// ellipsis, then "…". Space before the ellipsis is dropped, so a cut at a
// word break reads "word…", not "word …".
function cut(text: string, width: number): string {
  if (stringWidth(text) <= width) return text;
  let kept = "";
  let used = 0;
  for (const { segment } of graphemes.segment(text)) {
    const segmentWidth = stringWidth(segment);
    if (used + segmentWidth > width - 1) break;
    kept += segment;
    used += segmentWidth;
  }
  return `${kept.trimEnd()}${ELLIPSIS}`;
}

function padRight(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - stringWidth(text)));
}
