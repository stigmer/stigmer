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

/**
 * Resolves all `${ ... }` expressions in a config object. Deep-clones
 * the input, collects expressions, evaluates them as a batch via the
 * expression evaluator (local activity), and substitutes results back.
 *
 * Returns the fully-resolved config object.
 */
export async function resolveConfigExpressions(
  config: Record<string, unknown>,
  input: unknown,
  state: WorkflowState,
  evaluateExpressions: ExpressionEvaluator,
): Promise<Record<string, unknown>> {
  const cloned = deepClone(config);
  const expressions = collectExpressions(cloned);

  if (Object.keys(expressions).length === 0) {
    return cloned;
  }

  const stateVars = state.getAsMap();
  const results = await evaluateExpressions(expressions, input, stateVars);
  return substituteResults(cloned, results);
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
 * in a string using values from the runtime environment map.
 *
 * This runs in activities only — never in the workflow sandbox.
 */
export function resolveRuntimePlaceholders(
  value: string,
  runtimeEnv: Record<string, unknown>,
): string {
  return value.replace(
    /\$\{\.(secrets|env_vars)\.(\w+)\}/g,
    (_match, _ns: string, key: string) => {
      const resolved = runtimeEnv[key];
      return resolved !== undefined ? String(resolved) : "";
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
