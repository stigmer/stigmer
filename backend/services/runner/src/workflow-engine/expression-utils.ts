/**
 * Pure expression-parsing utilities safe for the Temporal workflow sandbox.
 *
 * These functions perform only synchronous string manipulation with zero
 * external dependencies — no Node.js built-ins, no Wasm, no I/O. They
 * can be imported from workflow-side code (inside the deterministic V8
 * isolate) without violating sandbox constraints.
 *
 * Activity-only evaluation logic (jq-wasm, crypto) remains in
 * `expression.ts` which must NOT be imported from workflow code.
 */

// ─────────────────────────────────────────────────────────────────────
// Expression Detection
// ─────────────────────────────────────────────────────────────────────

/**
 * Checks if a string is a strict runtime expression: `${ ... }`.
 * Matches Go's `model.IsStrictExpr` — requires the entire string to
 * be wrapped, with a space after `${`.
 */
export function isStrictExpr(str: string): boolean {
  return str.startsWith("${ ") && str.endsWith(" }");
}

/**
 * Strips the `${ ` prefix and ` }` suffix from a strict expression.
 * Matches Go's `model.SanitizeExpr`.
 */
export function sanitizeExpr(str: string): string {
  return str.slice(3, -2);
}

// ─────────────────────────────────────────────────────────────────────
// Embedded Expression Extraction (brace-depth tracking)
// ─────────────────────────────────────────────────────────────────────

export interface EmbeddedExpression {
  /** Byte offset of the opening `$` in the source string. */
  start: number;
  /** Byte offset one past the closing `}`. */
  end: number;
  /** The raw jq expression between `${ ` and ` }`. */
  expr: string;
}

const EMBEDDED_MARKER = "${ ";

/**
 * Scans a string for embedded `${ ... }` expressions using
 * brace-depth tracking. Returns an empty array when:
 * - The string contains no `${ ` markers
 * - The entire string IS a strict expression (handled separately)
 *
 * Brace-depth tracking correctly handles nested braces in jq object
 * construction (e.g. `${ { key: .value } }`), unlike a naive regex
 * which would stop at the first `}`.
 *
 * Known limitation: braces inside jq string literals (e.g. `${ "}" }`)
 * are counted structurally — the parser does not track quoted context.
 * This is acceptable because jq string literals containing literal
 * braces are not a realistic pattern in workflow config values.
 *
 * Runtime placeholders (`${.secrets.KEY}`, `${.env_vars.KEY}`) are
 * never matched because they lack the space after `${`.
 */
export function extractEmbeddedExpressions(str: string): EmbeddedExpression[] {
  if (isStrictExpr(str)) return [];

  const results: EmbeddedExpression[] = [];
  let searchFrom = 0;

  while (searchFrom < str.length) {
    const markerIdx = str.indexOf(EMBEDDED_MARKER, searchFrom);
    if (markerIdx === -1) break;

    const exprStart = markerIdx + EMBEDDED_MARKER.length;
    let depth = 1;
    let pos = exprStart;

    while (pos < str.length && depth > 0) {
      if (str[pos] === "{") depth++;
      else if (str[pos] === "}") depth--;
      if (depth > 0) pos++;
    }

    if (depth !== 0) {
      searchFrom = exprStart;
      continue;
    }

    const rawExpr = str.slice(exprStart, pos);
    const expr = rawExpr.endsWith(" ") ? rawExpr.slice(0, -1) : rawExpr;

    results.push({
      start: markerIdx,
      end: pos + 1,
      expr,
    });

    searchFrom = pos + 1;
  }

  return results;
}

/**
 * Checks whether a string contains embedded `${ ... }` expressions
 * that are NOT strict (the entire value is one expression) and NOT
 * runtime placeholders (`${.secrets.*}`).
 */
export function hasEmbeddedExpressions(str: string): boolean {
  if (isStrictExpr(str)) return false;
  return str.includes(EMBEDDED_MARKER);
}

// ─────────────────────────────────────────────────────────────────────
// Interpolation Helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Converts an evaluated expression result to a string for embedding
 * into a larger template string.
 */
export function stringifyInterpolatedValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
