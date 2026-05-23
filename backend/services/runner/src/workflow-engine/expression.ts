/**
 * Expression evaluation engine for CNCF Serverless Workflow runtime
 * expressions. Runs OUTSIDE the Temporal workflow sandbox (in a local
 * activity) using jq-wasm for evaluation.
 *
 * Supports:
 * - Strict expression detection: `${ .some.path }`
 * - Embedded expression interpolation: `"Hello ${ .name }!"`
 * - Expression sanitization: strips `${` and `}` wrapper
 * - Single expression evaluation via jq-wasm
 * - Recursive tree traversal for evaluating expressions in nested objects
 * - Conditional (if-statement) evaluation
 * - uuid() preprocessing (jq-wasm has no custom function support)
 *
 * The Go equivalent is `utils/runtime_expressions.go`.
 */

import * as jq from "jq-wasm";
import { randomUUID } from "node:crypto";

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

/**
 * Interpolates all embedded `${ ... }` expressions within a string.
 * Each expression is evaluated via jq and substituted in place.
 *
 * - `null` / `undefined` results become `""` (consistent with
 *   `resolveRuntimePlaceholders` in resolve.ts).
 * - Non-string results (objects, arrays, numbers) are JSON-stringified.
 * - String results are inserted directly.
 */
export async function interpolateString(
  str: string,
  input: unknown,
  stateVars: Record<string, unknown>,
): Promise<string> {
  const expressions = extractEmbeddedExpressions(str);
  if (expressions.length === 0) return str;

  let result = "";
  let lastEnd = 0;

  for (const embedded of expressions) {
    result += str.slice(lastEnd, embedded.start);
    const value = await evaluateExpression(embedded.expr, input, stateVars);
    result += stringifyInterpolatedValue(value);
    lastEnd = embedded.end;
  }

  result += str.slice(lastEnd);
  return result;
}

/**
 * Converts an evaluated expression result to a string for embedding
 * into a larger template string.
 */
export function stringifyInterpolatedValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

// ─────────────────────────────────────────────────────────────────────
// UUID Preprocessing
// ─────────────────────────────────────────────────────────────────────

const UUID_PATTERN = /\buuid\b/g;

/**
 * Replaces all occurrences of `uuid` in a jq expression with a
 * generated UUID string literal. jq-wasm doesn't support custom
 * function registration (Go uses `gojq.WithFunction("uuid", ...)`),
 * so we pre-process before evaluation.
 */
export function preprocessUuid(expr: string): { expr: string; hadUuid: boolean } {
  let hadUuid = false;
  const processed = expr.replace(UUID_PATTERN, () => {
    hadUuid = true;
    return `"${randomUUID()}"`;
  });
  return { expr: processed, hadUuid };
}

// ─────────────────────────────────────────────────────────────────────
// Single Expression Evaluation
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates a single jq expression against an input value, with
 * state variables available as jq `$variable` bindings.
 *
 * The state variables map provides `$context`, `$data`, `$env`,
 * `$input`, `$output` — matching Go's `state.GetAsMap()`.
 *
 * @param expr - Raw jq expression (already sanitized, no `${ }` wrapper)
 * @param input - The jq input value (`.` in jq)
 * @param stateVars - Map of `$variable` → value for jq variable bindings
 */
export async function evaluateExpression(
  expr: string,
  input: unknown,
  stateVars: Record<string, unknown>,
): Promise<unknown> {
  const { expr: processedExpr } = preprocessUuid(expr);

  const wrappedExpr = buildVariableBindingExpr(processedExpr, stateVars);
  const jqInput = buildJqInput(input, stateVars);

  const result = await jq.json(jqInput, wrappedExpr);
  return result;
}

/**
 * Wraps a jq expression with variable bindings by constructing a
 * combined input object and piping through `.as $var` assignments.
 *
 * For state vars `{ $context: {...}, $data: {...} }`, produces:
 * ```
 * .__vars__.$context as $context | .__vars__.$data as $data | ... | .__body__ | <expr>
 * ```
 *
 * The actual jq input becomes `{ __body__: <original input>, __vars__: <stateVars> }`.
 */
function buildVariableBindingExpr(
  expr: string,
  stateVars: Record<string, unknown>,
): string {
  const varNames = Object.keys(stateVars);
  if (varNames.length === 0) return expr;

  const bindings = varNames
    .map((name) => `.__vars__.["${name}"] as ${name}`)
    .join(" | ");

  return `${bindings} | .__body__ | ${expr}`;
}

/**
 * Wraps the input value with state variables for jq evaluation.
 * The jq expression produced by `buildVariableBindingExpr` expects
 * this shape.
 */
export function buildJqInput(
  input: unknown,
  stateVars: Record<string, unknown>,
): object {
  if (Object.keys(stateVars).length === 0) return (input ?? {}) as object;

  return {
    __body__: input ?? {},
    __vars__: stateVars,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Batch Expression Evaluation
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates multiple expressions in a single call. Each expression
 * is evaluated independently against the same input and state.
 *
 * Used by the local activity to batch-evaluate all expressions
 * needed by a task in one round-trip.
 */
export async function evaluateExpressionBatch(
  expressions: Record<string, string>,
  input: unknown,
  stateVars: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  const entries = Object.entries(expressions);

  for (const [key, expr] of entries) {
    results[key] = await evaluateExpression(expr, input, stateVars);
  }

  return results;
}

// ─────────────────────────────────────────────────────────────────────
// String Evaluation (detect + evaluate if expression)
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates a string value using a three-step chain:
 *
 * 1. **Strict**: If the entire string is `${ expr }`, evaluate via
 *    jq and return the result (may be any type — object, number, etc.).
 * 2. **Embedded**: If the string contains `${ expr }` fragments within
 *    larger text, interpolate each fragment and return a string.
 * 3. **Passthrough**: Return the string unchanged.
 *
 * The CNCF Serverless Workflow 1.0.0 spec demonstrates embedded
 * expressions in multi-line strings (e.g., HTTP body templates).
 */
export async function evaluateString(
  str: string,
  input: unknown,
  stateVars: Record<string, unknown>,
): Promise<unknown> {
  if (isStrictExpr(str)) {
    return evaluateExpression(sanitizeExpr(str), input, stateVars);
  }
  if (hasEmbeddedExpressions(str)) {
    return interpolateString(str, input, stateVars);
  }
  return str;
}

// ─────────────────────────────────────────────────────────────────────
// Recursive Tree Traversal
// ─────────────────────────────────────────────────────────────────────

/**
 * Recursively walks a value tree, evaluating any string expression
 * (`${ ... }`) found at any depth. Maps and arrays are traversed
 * recursively; strings are checked for expressions; all other types
 * pass through unchanged.
 *
 * Matches Go's `utils.TraverseAndEvaluateObj` + `traverseAndEvaluate`.
 *
 * IMPORTANT: Mutates the input object in place (maps and arrays).
 * Clone before calling if you need the original preserved.
 */
export async function traverseAndEvaluate(
  node: unknown,
  input: unknown,
  stateVars: Record<string, unknown>,
): Promise<unknown> {
  if (node === null || node === undefined) return node;

  if (typeof node === "string") {
    return evaluateString(node, input, stateVars);
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      node[i] = await traverseAndEvaluate(node[i], input, stateVars);
    }
    return node;
  }

  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const key of Object.keys(obj)) {
      obj[key] = await traverseAndEvaluate(obj[key], input, stateVars);
    }
    return obj;
  }

  return node;
}

// ─────────────────────────────────────────────────────────────────────
// Conditional (If-Statement) Evaluation
// ─────────────────────────────────────────────────────────────────────

/**
 * Evaluates a task's `if` condition. Returns true if:
 * - No condition is specified (task always runs)
 * - The expression evaluates to `true` (boolean)
 * - The expression evaluates to "TRUE" (case-insensitive string)
 * - The expression evaluates to "1"
 *
 * Matches Go's `utils.CheckIfStatement`.
 */
export async function checkIfStatement(
  ifExpr: string | undefined,
  input: unknown,
  stateVars: Record<string, unknown>,
): Promise<boolean> {
  if (ifExpr === undefined || ifExpr === null) return true;

  const result = await evaluateString(ifExpr, input, stateVars);

  if (typeof result === "boolean") return result;
  if (typeof result === "string") {
    return result.toUpperCase() === "TRUE" || result === "1";
  }

  return false;
}
