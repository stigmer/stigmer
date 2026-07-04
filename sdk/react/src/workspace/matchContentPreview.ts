// Pure highlight helper behind content search. Kept separate from the hook and
// component so the offset math is exhaustively unit-testable in isolation (no
// React, no async).
//
// The backend returns each hit's `preview` line but no column offset (a
// cross-language byte/UTF-16 offset would be brittle — see WorkspaceContentMatch).
// Since matching is case-insensitive substring, the client re-derives the
// highlight span(s) from the preview text itself, identically to how
// `matchWorkspaceFiles` derives the filename highlight range. `@internal`.

/**
 * A half-open `[start, end)` range of code-unit offsets into a preview string,
 * marking one occurrence of the query to emphasize.
 */
export interface HighlightRange {
  /** Inclusive start offset within the preview. */
  readonly start: number;
  /** Exclusive end offset within the preview. */
  readonly end: number;
}

/**
 * Finds every case-insensitive occurrence of `query` within `preview`,
 * best-effort for rendering emphasis.
 *
 * - Empty/whitespace query → `[]` (nothing to highlight).
 * - Overlapping matches cannot occur (search advances past each match end).
 * - Offsets are JS string code units, so a consumer highlights with
 *   `preview.slice(start, end)`.
 */
export function findHighlightRanges(
  preview: string,
  query: string,
): HighlightRange[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];

  const haystack = preview.toLowerCase();
  const ranges: HighlightRange[] = [];

  let from = 0;
  for (;;) {
    const start = haystack.indexOf(needle, from);
    if (start === -1) break;
    const end = start + needle.length;
    ranges.push({ start, end });
    from = end;
  }

  return ranges;
}
