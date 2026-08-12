/**
 * Shared expression resolution utilities for task builders.
 *
 * Extracts the expression collection and substitution logic that was
 * originally embedded in set.ts into reusable functions. All call task
 * builders (call:http, call:grpc, call:function) use these to evaluate
 * `${ ... }` expressions in their `with` config before scheduling
 * Temporal activities.
 *
 * Two-phase evaluation (security pattern from Go):
 * 1. Workflow side: resolve `${ $context.field }` etc. via these utilities
 * 2. Activity side: resolve `${.secrets.KEY}` just-in-time (never in history)
 */

import type { ExpressionEvaluator, WorkflowState } from "./types.js";
import { deepClone } from "./clone.js";
import {
  extractEmbeddedExpressions,
  isStrictExpr,
  stringifyInterpolatedValue,
} from "./expression-utils.js";

/**
 * Resolves all `${ ... }` expressions in a config object using a
 * two-phase pipeline:
 *
 * **Phase 1 — Strict expressions** (existing): whole-value `${ expr }`
 * strings are collected, batch-evaluated, and substituted.
 *
 * **Phase 2 — Embedded expressions** (CNCF spec compliant): strings
 * containing `${ expr }` fragments within larger text are collected,
 * batch-evaluated, and interpolated. This enables multi-line agent
 * messages, LLM prompts, and notification bodies with inline variable
 * references — as demonstrated in the official CNCF Serverless Workflow
 * 1.0.0 spec reference examples.
 *
 * Each phase produces at most one Temporal local activity call (batch
 * evaluation). Phase 2 is skipped when no embedded expressions exist.
 */
export async function resolveConfigExpressions(
  config: Record<string, unknown>,
  input: unknown,
  state: WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
): Promise<Record<string, unknown>> {
  const cloned = deepClone(config);
  const stateVars = state.getAsMap();

  // Phase 1: Strict expressions (whole-value `${ expr }`)
  const strictExprs = collectExpressions(cloned);
  let phase1Paths: Set<string> = new Set();
  if (Object.keys(strictExprs).length > 0) {
    const strictResults = await evaluateExpressions(strictExprs, input, stateVars);
    substituteResults(cloned, strictResults);
    phase1Paths = new Set(Object.keys(strictExprs));
  }

  // Phase 2: Embedded expressions (`"text ${ expr } more text"`)
  // Skip paths already resolved in Phase 1 to prevent expression injection —
  // Phase 1 results may contain `${ ... }` patterns from external data
  // (webhook payloads, API responses) that must NOT be re-interpreted.
  await resolveEmbeddedExpressions(cloned, input, stateVars, evaluateExpressions, phase1Paths);

  return cloned;
}

/**
 * Collects all string expressions (`${ ... }`) from a nested object
 * into a flat map keyed by their JSON path. Non-expression strings
 * and non-string values are skipped.
 */
export function collectExpressions(
  obj: Record<string, unknown>,
  prefix = "",
): Record<string, string> {
  const expressions: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "string" && value.startsWith("${ ") && value.endsWith(" }")) {
      expressions[path] = value.slice(3, -2);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(
        expressions,
        collectExpressions(value as Record<string, unknown>, path),
      );
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemPath = `${path}[${i}]`;
        if (typeof value[i] === "string" && value[i].startsWith("${ ") && value[i].endsWith(" }")) {
          expressions[itemPath] = value[i].slice(3, -2);
        } else if (value[i] !== null && typeof value[i] === "object") {
          Object.assign(
            expressions,
            collectExpressions(value[i] as Record<string, unknown>, itemPath),
          );
        }
      }
    }
  }

  return expressions;
}

/**
 * Substitutes evaluated expression results back into the original
 * object structure. Expression paths (e.g., "body.userId") are
 * resolved to their positions in the object tree.
 */
export function substituteResults(
  obj: Record<string, unknown>,
  results: Record<string, unknown>,
): Record<string, unknown> {
  for (const [path, value] of Object.entries(results)) {
    setNestedValue(obj, path, value);
  }
  return obj;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  let current: unknown = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof part === "number") {
      current = (current as unknown[])[part];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  const lastPart = parts[parts.length - 1];
  if (typeof lastPart === "number") {
    (current as unknown[])[lastPart] = value;
  } else {
    (current as Record<string, unknown>)[lastPart] = value;
  }
}

function parsePath(path: string): (string | number)[] {
  const parts: (string | number)[] = [];
  const segments = path.split(".");

  for (const segment of segments) {
    const bracketMatch = segment.match(/^(.+?)\[(\d+)\]$/);
    if (bracketMatch) {
      parts.push(bracketMatch[1]);
      parts.push(Number(bracketMatch[2]));
    } else {
      parts.push(segment);
    }
  }

  return parts;
}

const RUNTIME_PLACEHOLDER_RE = /\$\{\.(secrets|env_vars)\.\w+\}/;

/** Substitution form of {@link RUNTIME_PLACEHOLDER_RE} (global, capturing). */
const RUNTIME_PLACEHOLDER_SUB_RE = /\$\{\.(secrets|env_vars)\.(\w+)\}/g;

/**
 * Checks whether a string contains a runtime placeholder that should
 * NOT be evaluated in the workflow (deterministic) phase. These are
 * resolved just-in-time in the activity where secrets are available.
 *
 * Pattern: `${.secrets.KEY}` or `${.env_vars.KEY}`
 * (no space after `${` — distinguishes from jq expressions `${ ... }`)
 */
export function isRuntimePlaceholder(value: string): boolean {
  return RUNTIME_PLACEHOLDER_RE.test(value);
}

/**
 * Resolves runtime placeholders (`${.secrets.KEY}`, `${.env_vars.KEY}`)
 * in a string using values from the runtime environment map. Missing
 * keys resolve to `""` — callers that must fail loudly instead use
 * {@link resolveRuntimePlaceholdersStrict}.
 *
 * This runs in activities only — never in the workflow sandbox.
 */
export function resolveRuntimePlaceholders(
  value: string,
  runtimeEnv: Record<string, unknown>,
): string {
  return value.replace(
    RUNTIME_PLACEHOLDER_SUB_RE,
    (_match, _ns: string, key: string) => {
      const resolved = runtimeEnv[key];
      return resolved !== undefined ? String(resolved) : "";
    },
  );
}

/** Thrown by {@link resolveRuntimePlaceholdersStrict} for a missing key. */
export class RuntimePlaceholderResolutionError extends Error {
  constructor(
    public readonly variableName: string,
    public readonly context?: string,
  ) {
    const where = context ? ` in ${context}` : "";
    super(
      `Unresolved runtime placeholder for "${variableName}"${where}: ` +
        `variable is not present in the workflow's runtime environment`,
    );
    this.name = "RuntimePlaceholderResolutionError";
  }
}

/**
 * Strict variant of {@link resolveRuntimePlaceholders}: a placeholder
 * whose key is missing from the runtime environment throws instead of
 * resolving to `""` — a silently-empty credential produces cryptic
 * downstream failures, so declared-value consumers (the run task's env
 * contract) fail fast with the variable named.
 *
 * This runs in activities only — never in the workflow sandbox.
 */
export function resolveRuntimePlaceholdersStrict(
  value: string,
  runtimeEnv: Record<string, unknown>,
  context?: string,
): string {
  return value.replace(
    RUNTIME_PLACEHOLDER_SUB_RE,
    (_match, _ns: string, key: string) => {
      const resolved = runtimeEnv[key];
      if (resolved === undefined) {
        throw new RuntimePlaceholderResolutionError(key, context);
      }
      return String(resolved);
    },
  );
}

/**
 * Recursively resolves all runtime placeholders in a nested object.
 * Walks maps, arrays, and strings. Non-string leaves pass through.
 */
export function resolveObjectPlaceholders(
  obj: unknown,
  runtimeEnv: Record<string, unknown>,
): unknown {
  if (typeof obj === "string") {
    return resolveRuntimePlaceholders(obj, runtimeEnv);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => resolveObjectPlaceholders(item, runtimeEnv));
  }
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveObjectPlaceholders(value, runtimeEnv);
    }
    return result;
  }
  return obj;
}

// ─────────────────────────────────────────────────────────────────────
// Embedded Expression Resolution (Phase 2)
// ─────────────────────────────────────────────────────────────────────

interface EmbeddedExprMapping {
  /** JSON path to the string field in the config object. */
  path: string;
  /** Ordered list of expressions found in that string. */
  expressions: Array<{ start: number; end: number; expr: string }>;
}

/**
 * Resolves embedded `${ ... }` expressions within string values of a
 * config object. Strings where the entire value is a strict expression
 * are skipped (already handled in Phase 1). Only strings containing
 * `${ ... }` fragments within larger text are processed.
 *
 * All embedded expressions across all fields are collected and
 * evaluated in a single batch call to the expression evaluator,
 * preserving the Temporal local activity batch optimization.
 *
 * Mutates `obj` in place. Returns early if no embedded expressions
 * are found (zero overhead for strict-only workflows).
 *
 * @param skipPaths - Paths already resolved in Phase 1 whose string
 *   results must not be re-interpolated (prevents expression injection
 *   from external data flowing through `$context`).
 */
export async function resolveEmbeddedExpressions(
  obj: Record<string, unknown>,
  input: unknown,
  stateVars: Record<string, unknown>,
  evaluateExpressions: ExpressionEvaluator,
  skipPaths: Set<string> = new Set(),
): Promise<void> {
  const mappings: EmbeddedExprMapping[] = [];
  const batchExprs: Record<string, string> = {};

  collectEmbeddedExpressions(obj, "", mappings, batchExprs, skipPaths);

  if (Object.keys(batchExprs).length === 0) return;

  const results = await evaluateExpressions(batchExprs, input, stateVars);

  for (const mapping of mappings) {
    const original = getNestedValue(obj, mapping.path) as string;
    let interpolated = "";
    let lastEnd = 0;

    for (let i = 0; i < mapping.expressions.length; i++) {
      const embedded = mapping.expressions[i];
      // Tilde cannot appear in dot/bracket JSON paths, so it's unambiguous as a separator.
      const key = `${mapping.path}~${i}`;
      interpolated += original.slice(lastEnd, embedded.start);
      interpolated += stringifyInterpolatedValue(results[key]);
      lastEnd = embedded.end;
    }

    interpolated += original.slice(lastEnd);
    setNestedValue(obj, mapping.path, interpolated);
  }
}

/**
 * Walks the object tree collecting embedded expressions from string
 * values into the batch map. Each expression gets a composite key
 * `path~index` so results can be mapped back to their source strings.
 */
function collectEmbeddedExpressions(
  obj: Record<string, unknown>,
  prefix: string,
  mappings: EmbeddedExprMapping[],
  batchExprs: Record<string, string>,
  skipPaths: Set<string>,
): void {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    collectEmbeddedFromValue(value, path, mappings, batchExprs, skipPaths);
  }
}

function collectEmbeddedFromValue(
  value: unknown,
  path: string,
  mappings: EmbeddedExprMapping[],
  batchExprs: Record<string, string>,
  skipPaths: Set<string>,
): void {
  // A Phase-1-resolved path holds data, not template text: skip its
  // entire subtree, whatever shape it resolved to. A strict expression
  // can resolve to an object or array whose nested strings carry literal
  // `${ ... }` text from external sources (webhook payloads, API
  // responses, documents under review) that must never be re-interpreted
  // as expressions. Checking only string values at the exact path — the
  // previous behavior — left those nested strings exposed.
  if (skipPaths.has(path)) return;

  if (typeof value === "string") {
    if (isStrictExpr(value)) return;
    const expressions = extractEmbeddedExpressions(value);
    if (expressions.length === 0) return;

    mappings.push({ path, expressions });
    for (let i = 0; i < expressions.length; i++) {
      batchExprs[`${path}~${i}`] = expressions[i].expr;
    }
  } else if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      collectEmbeddedFromValue(value[i], `${path}[${i}]`, mappings, batchExprs, skipPaths);
    }
  } else if (value !== null && typeof value === "object") {
    collectEmbeddedExpressions(
      value as Record<string, unknown>,
      path,
      mappings,
      batchExprs,
      skipPaths,
    );
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = parsePath(path);
  let current: unknown = obj;

  for (const part of parts) {
    if (typeof part === "number") {
      current = (current as unknown[])[part];
    } else {
      current = (current as Record<string, unknown>)[part];
    }
  }

  return current;
}
