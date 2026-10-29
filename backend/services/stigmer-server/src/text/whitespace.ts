/**
 * Trimming and splitting by the Unicode White_Space property: ASCII spaces,
 * U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F and
 * U+3000, and NOT U+FEFF.
 *
 * Why not String.trim or `\s`: their set is White_Space PLUS U+FEFF and
 * MINUS U+0085, so they disagree on BOM'd and NEL-padded input. Two readers
 * depend on the difference. SKILL.md frontmatter refuses a "---" line that
 * carries a BOM. Search decides list mode from the trimmed query, so a query
 * of exactly "\uFEFF" runs an empty-match search instead of listing
 * everything, and "\u0085" is the mirror image.
 *
 * Proven by src/text/__tests__/whitespace.test.ts and both readers' suites.
 */
const WHITE_SPACE_CLASS =
  "\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";

const TRIM_PATTERN = new RegExp(
  `^[${WHITE_SPACE_CLASS}]+|[${WHITE_SPACE_CLASS}]+$`,
  "g",
);

const SPLIT_PATTERN = new RegExp(`[${WHITE_SPACE_CLASS}]+`);

export function trimWhiteSpace(value: string): string {
  return value.replace(TRIM_PATTERN, "");
}

/**
 * Splits around runs of White_Space. The `\s` hazard mirrors trim's: `\s`
 * splits on U+FEFF and misses U+0085, which would change the search terms a
 * query produces on exactly those inputs. Returns no empty fields; an
 * all-space (or empty) input yields [].
 */
export function splitOnWhiteSpace(value: string): string[] {
  const trimmed = trimWhiteSpace(value);
  return trimmed === "" ? [] : trimmed.split(SPLIT_PATTERN);
}
