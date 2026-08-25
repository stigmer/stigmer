/**
 * Go strings.TrimSpace — trims by unicode.IsSpace, the Unicode White_Space
 * property (ASCII spaces, U+0085, U+00A0, U+1680, U+2000–U+200A, U+2028,
 * U+2029, U+202F, U+205F, U+3000) — which EXCLUDES U+FEFF. JS String.trim's
 * set is White_Space PLUS U+FEFF and MINUS U+0085, so the two disagree on
 * BOM'd and NEL-padded input: a .trim()-based port flips Go's verdict on
 * both (first found by the #8 skill parity panel on BOM'd SKILL.md files;
 * promoted here when search criteria became the second consumer — a
 * .trim()'d search query of exactly "\uFEFF" reads as LIST MODE where Go
 * runs an empty-match SEARCH, and "\u0085" the mirror image).
 *
 * Proven by src/gocompat/__tests__/trim.test.ts and both consumers' suites.
 */
const GO_SPACE_CLASS =
  "\\t\\n\\v\\f\\r \\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000";

const GO_TRIM_PATTERN = new RegExp(
  `^[${GO_SPACE_CLASS}]+|[${GO_SPACE_CLASS}]+$`,
  "g",
);

const GO_FIELDS_PATTERN = new RegExp(`[${GO_SPACE_CLASS}]+`);

export function goTrimSpace(value: string): string {
  return value.replace(GO_TRIM_PATTERN, "");
}

/**
 * Go strings.Fields — splits around runs of unicode.IsSpace. The JS twin
 * hazard mirrors trim's: `\s` splits on U+FEFF (Go does not) and misses
 * U+0085 (Go splits) — a `\s+`-based split changes which FTS5 tokens a
 * query produces on exactly those inputs. Returns no empty fields; an
 * all-space (or empty) input yields [].
 */
export function goFields(value: string): string[] {
  const trimmed = goTrimSpace(value);
  return trimmed === "" ? [] : trimmed.split(GO_FIELDS_PATTERN);
}
