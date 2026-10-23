/**
 * Where to cut a long text that keeps its start and its end: the one rule the
 * model-side cut of a tool result (`middleware/tool-truncation.ts`) and the
 * shell's capture of a stream (`shared/shell/run-command.ts`) share.
 *
 * A cut prefers a line end that falls in the last tenth of its budget, so the
 * kept start ends on a whole line and the kept end starts on one: a command's
 * output, a log or a listing reads as whole lines either side of the gap.
 * Text with no line end there (a single long line, minified JSON) is cut by
 * characters. Either way a cut never falls between the two halves of a
 * surrogate pair: half an emoji or a CJK character is an invalid string to
 * the provider, and a JSON encoder writes it as a lone escape.
 */

/** The share of a budget a cut may give up to land on a line end. */
const LINE_END_REACH = 0.1;

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * The end of the kept start, at most `budget` characters of `text` (which
 * goes on past them, here or in a stream): just after the last line end in
 * the budget's last tenth, else `budget`, moved back off a surrogate pair's
 * middle.
 */
export function headCutIndex(text: string, budget: number): number {
  const end = Math.min(Math.max(0, budget), text.length);
  if (end === 0) return end;
  const lineEnd = text.lastIndexOf("\n", end - 1);
  if (lineEnd >= 0 && end - (lineEnd + 1) <= budget * LINE_END_REACH) return lineEnd + 1;
  return isHighSurrogate(text.charCodeAt(end - 1)) ? end - 1 : end;
}

/**
 * The start of the kept end, leaving at most `budget` characters of `text`
 * (which came after more, here or in a stream): just after the first line end
 * in the budget's first tenth, else `text.length - budget`, moved forward off
 * a surrogate pair's middle.
 */
export function tailCutIndex(text: string, budget: number): number {
  const start = Math.max(0, text.length - Math.max(0, budget));
  if (start === text.length || (start > 0 && text.charCodeAt(start - 1) === 0x0a)) return start;
  const lineEnd = text.indexOf("\n", start);
  if (lineEnd >= 0 && lineEnd + 1 - start <= budget * LINE_END_REACH) return lineEnd + 1;
  return start < text.length && isLowSurrogate(text.charCodeAt(start)) ? start + 1 : start;
}
