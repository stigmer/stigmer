/**
 * Resolving an edit the model quoted loosely to the file's exact bytes.
 *
 * WHY
 * ---
 * deepagents' `edit_file` is an exact substring replace. When the text the
 * model quotes differs from the file only in ways it cannot see or rarely
 * reproduces (a curly quote typed straight, a trailing space not copied, the
 * invisible "\r" of a Windows line ending, which `read_file` leaves on every
 * line because it splits on "\n" only), the edit fails and the agent spends a
 * round re-reading the file. This module finds the region the model meant and
 * returns it as exact text, so deepagents' own replace performs the edit and
 * re-verifies it against the file. The model is not told: the tool still says
 * "must match exactly", and this is a net, not a licence.
 *
 * THE TIERS
 * ---------
 * Each tier is tried only when the one before found nothing; the ladder is
 * OpenCode's edit tool (anomalyco/opencode at 37d9737,
 * `packages/core/src/tool/plugin/edit.ts`):
 * 1. exact on the file as stored: `exact`, and the caller passes the model's
 *    call through untouched, so today's path is byte-identical;
 * 2. exact on the LF view (every CRLF read as LF), offsets mapped back;
 * 3. typographic folding on the LF view: curly quotes, dashes and the
 *    non-breaking spaces folded one character to one, so view offsets map
 *    straight back;
 * 4. trailing whitespace ignored per line, over folded whole lines.
 * Indentation is never folded and nothing is edit-distance fuzzy: one input
 * always resolves to one region, or to a refusal.
 *
 * AMBIGUITY FAILS AS TODAY
 * ------------------------
 * More than one match at the first tier with matches, without `replace_all`,
 * fails in deepagents' own multiple-occurrence words. With `replace_all` the
 * matches must be byte-identical in the file, so one exact string covers them.
 * And the resolved text must occur in the file exactly where the loose matches
 * are: deepagents counts substrings anywhere, so a whole-line match whose bytes
 * also sit inside a longer line would otherwise fail later, or under
 * `replace_all` reach a place the model never named. Every refusal keeps the
 * "has multiple occurrences" wording that readers of the tool result
 * (the benchmark's per-call facts among them) already know.
 *
 * KEPT LINES KEEP THEIR BYTES
 * ---------------------------
 * The replacement is rebuilt line by line against the model's own quote: a
 * replacement line identical to a line the model quoted (longest common
 * subsequence) is a line the model did not mean to change, and takes the
 * file's bytes for it (its curly quotes, its trailing spaces, its ending); a
 * changed line is the model's text as written, ending as the line it replaces
 * did; a new line takes the region's dominant ending. So a CRLF file stays
 * CRLF and an untouched context line keeps its exact bytes, where OpenCode
 * keeps only the endings.
 *
 * Pure text in, text out, with no deepagents import, so it is tested as a
 * table; `activities/execute-deep-agent/loose-edit.ts` is the half that reads
 * the file and calls the backend.
 */

/** Which tier found the region, as the repair log names it. */
export type LooseTier = "line-endings" | "typography" | "trailing-whitespace";

/** What an edit resolves to against the file's current text. */
export type EditResolution =
  /** The model's text occurs as written: pass the call through untouched. */
  | { readonly kind: "exact" }
  /** No tier finds it: pass the call through, and it fails as today. */
  | { readonly kind: "none" }
  /** Found loosely: perform the edit with this exact text instead. */
  | { readonly kind: "resolved"; readonly tier: LooseTier; readonly oldString: string; readonly newString: string }
  /** Found loosely in more than one place it cannot tell apart: refuse with this error. */
  | { readonly kind: "ambiguous"; readonly error: string };

interface Span {
  readonly start: number;
  readonly end: number;
}

const CRLF = "\r\n";

/** Typographic variants folded to their ASCII form, one character to one. */
export function foldTypography(value: string): string {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/[  -   　]/g, " ");
}

/** Resolve one `edit_file` call against the file's text (module header). */
export function resolveEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): EditResolution {
  if (oldString === "") return { kind: "none" };
  if (content.includes(oldString)) return { kind: "exact" };

  const quote = oldString.replaceAll(CRLF, "\n");
  const found = findLoosely(content, quote);
  if (found === undefined) return { kind: "none" };

  const { tier, spans } = found;
  if (spans.length > 1 && !replaceAll) {
    return { kind: "ambiguous", error: deepagentsMultipleOccurrences(oldString, spans.length) };
  }
  const region = content.slice(spans[0].start, spans[0].end);
  if (spans.some((span) => content.slice(span.start, span.end) !== region)) {
    return {
      kind: "ambiguous",
      error: unresolvable(oldString, `${spans.length} loose matches that differ from each other`),
    };
  }
  const exactStarts = findOccurrences(content, region).map((span) => span.start);
  if (exactStarts.length !== spans.length || exactStarts.some((start, i) => start !== spans[i].start)) {
    return {
      kind: "ambiguous",
      error: unresolvable(oldString, "the file text it matches also appears where it was not quoted"),
    };
  }

  const fallback = dominantEnding(region, dominantEnding(content, "\n"));
  return {
    kind: "resolved",
    tier,
    oldString: region,
    newString: rebuildReplacement(region, quote.split("\n"), newString.replaceAll(CRLF, "\n"), fallback),
  };
}

/** deepagents' own words for an ambiguous exact match (`performStringReplacement`, deepagents 1.14.1). */
function deepagentsMultipleOccurrences(oldString: string, count: number): string {
  return (
    `Error: String '${oldString}' has multiple occurrences (appears ${count} times) in file. ` +
    "Use replace_all=True to replace all instances, or provide a more specific string with surrounding context."
  );
}

/** The same wording, with the reason a loose match cannot become one exact string. */
function unresolvable(oldString: string, reason: string): string {
  return (
    `Error: String '${oldString}' has multiple occurrences (${reason}) in file. ` +
    "Quote the text exactly as the file has it, or provide a more specific string with surrounding context."
  );
}

/** The first tier with matches, its spans in the file's own offsets. */
function findLoosely(content: string, quote: string): { tier: LooseTier; spans: Span[] } | undefined {
  const view = content.replaceAll(CRLF, "\n");
  // The view offset of every "\n" that stood for a CRLF: each removed "\r" sat just before it.
  const removed = [...content.matchAll(/\r\n/g)].map((match, i) => match.index - i);
  const toContent = (span: Span): Span => ({
    start: span.start + countBefore(removed, span.start),
    end: span.end + countBefore(removed, span.end),
  });

  const tiers: ReadonlyArray<readonly [LooseTier, () => Span[]]> = [
    ["line-endings", () => findOccurrences(view, quote)],
    ["typography", () => findOccurrences(foldTypography(view), foldTypography(quote))],
    ["trailing-whitespace", () => findLineOccurrences(view, quote)],
  ];
  for (const [tier, find] of tiers) {
    const spans = find();
    if (spans.length > 0) return { tier, spans: spans.map(toContent) };
  }
  return undefined;
}

/** Non-overlapping occurrences, left to right: the ones `content.split(search)` counts. */
function findOccurrences(content: string, search: string): Span[] {
  const spans: Span[] = [];
  for (let at = content.indexOf(search); at !== -1; at = content.indexOf(search, at + search.length)) {
    spans.push({ start: at, end: at + search.length });
  }
  return spans;
}

/**
 * Whole-line matches whose lines agree once folded and right-trimmed. A quote
 * ending in "\n" matches through the last line's newline; otherwise the match
 * stops before the last line's ending.
 */
function findLineOccurrences(view: string, quote: string): Span[] {
  const throughNewline = quote.endsWith("\n");
  const expected = (throughNewline ? quote.slice(0, -1) : quote).split("\n").map(lineKey);
  const lines = [...view.matchAll(/[^\n]*(?:\n|$)/g)]
    .filter((match) => match[0] !== "")
    .map((match) => {
      const newline = match[0].endsWith("\n");
      const text = newline ? match[0].slice(0, -1) : match[0];
      return { start: match.index, end: match.index + match[0].length, key: lineKey(text), textEnd: match.index + text.length, newline };
    });

  const spans: Span[] = [];
  for (let first = 0; first + expected.length <= lines.length; first++) {
    const window = lines.slice(first, first + expected.length);
    if (!window.every((line, i) => line.key === expected[i])) continue;
    const last = window[window.length - 1];
    if (throughNewline && !last.newline) continue;
    const span = { start: window[0].start, end: throughNewline ? last.end : last.textEnd };
    if (spans.length > 0 && spans[spans.length - 1].end > span.start) continue;
    spans.push(span);
  }
  return spans;
}

function lineKey(line: string): string {
  return foldTypography(line.trimEnd());
}

/** Number of sorted positions strictly before `offset`. */
function countBefore(positions: readonly number[], offset: number): number {
  let low = 0;
  let high = positions.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (positions[middle] < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** The dominant line ending in `text`, or `fallback` on a tie. */
function dominantEnding(text: string, fallback: string): string {
  const crlf = text.split(CRLF).length - 1;
  const lf = text.split("\n").length - 1 - crlf;
  if (crlf === lf) return fallback;
  return crlf > lf ? CRLF : "\n";
}

/**
 * The replacement in the file's bytes (module header, "Kept lines keep their
 * bytes"). `quoted` is the model's quote split into lines, one per line of
 * `region` by construction of every tier.
 */
function rebuildReplacement(region: string, quoted: readonly string[], replacement: string, fallback: string): string {
  const regionLines = region.split(/\r?\n/);
  const endings = [...region.matchAll(/\r?\n/g)].map((match) => match[0]);
  const lines = replacement.split("\n");
  const counterpart = alignLines(quoted, lines);
  return lines
    .map((line, j) => {
      const i = counterpart[j];
      const text = i !== undefined && quoted[i] === line ? regionLines[i] : line;
      if (j === lines.length - 1) return text;
      return text + ((i !== undefined ? endings[i] : undefined) ?? fallback);
    })
    .join("");
}

/**
 * For each line of `after`, the index of the `before` line it keeps (longest
 * common subsequence) or, between kept lines, the line it takes the place of;
 * undefined for a line with no counterpart (OpenCode's `alignLines`).
 */
function alignLines(before: readonly string[], after: readonly string[]): Array<number | undefined> {
  const width = after.length + 1;
  const table = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const result: Array<number | undefined> = new Array<number | undefined>(after.length).fill(undefined);
  let gapBefore: number[] = [];
  let gapAfter: number[] = [];
  const flush = (): void => {
    gapAfter.forEach((j, k) => (result[j] = gapBefore[k]));
    gapBefore = [];
    gapAfter = [];
  };
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      flush();
      result[j++] = i++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      gapBefore.push(i++);
    } else {
      gapAfter.push(j++);
    }
  }
  while (i < before.length) gapBefore.push(i++);
  while (j < after.length) gapAfter.push(j++);
  flush();
  return result;
}
