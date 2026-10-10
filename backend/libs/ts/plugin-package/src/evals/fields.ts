/**
 * The field readers every eval document shares: a collector for the
 * sentences a case's files produce, the typed reads over a parsed YAML
 * mapping, and the regex compile check.
 *
 * Every finding is one sentence that starts with the plugin-relative file
 * and names the field, the shape Claude Code's loader prints
 * (`prompt.md: unknown frontmatter key 'foo'`), so the CLI and the plugin
 * page show an author the same words. A read that fails records its finding
 * and returns `undefined`; the caller keeps reading so one pass names every
 * problem in the file, and the case loads only when its collector stayed
 * empty.
 *
 * Regexes are compiled here and never run: compiling a JavaScript pattern
 * is linear in its length, and running author patterns is the grader's
 * job, behind its own time limit.
 */

import { isJsonObject, isStringArray, type JsonObject } from "../documents.js";
import type { EvalSuiteFinding } from "./types.js";

export type EvalFindingKind = EvalSuiteFinding["kind"];

/** The findings one case's files produced. */
export class CaseFindings {
  readonly list: EvalSuiteFinding[] = [];

  add(kind: EvalFindingKind, path: string, problem: string): void {
    this.list.push({ kind, path, message: `${path}: ${problem}` });
  }

  get empty(): boolean {
    return this.list.length === 0;
  }
}

/** Where a field is being read: the file, how its fields are named, and the kind a wrong value is. */
export interface FieldScope {
  readonly path: string;
  /** Prepended to each field name in a sentence, e.g. "execution." or "grader 'x': ". */
  readonly label: string;
  readonly invalid: Extract<EvalFindingKind, "eval-case-invalid" | "eval-grader-invalid">;
  readonly findings: CaseFindings;
}

export function wrong(scope: FieldScope, field: string, expected: string): undefined {
  scope.findings.add(scope.invalid, scope.path, `${scope.label}${field} must be ${expected}`);
  return undefined;
}

/** Report every key of `object` not in `known` as `kind`, in document order. */
export function unknownKeys(
  object: JsonObject,
  known: ReadonlySet<string>,
  scope: FieldScope,
  kind: EvalFindingKind,
  noun: string,
): void {
  for (const key of Object.keys(object)) {
    if (!known.has(key)) scope.findings.add(kind, scope.path, `unknown ${noun} '${scope.label}${key}'`);
  }
}

export function readString(object: JsonObject, field: string, scope: FieldScope): string | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") return wrong(scope, field, "a string");
  return value;
}

export function readNonEmptyString(object: JsonObject, field: string, scope: FieldScope): string | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim() === "") return wrong(scope, field, "a non-empty string");
  return value;
}

export function readStringList(object: JsonObject, field: string, scope: FieldScope): readonly string[] | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (!isStringArray(value)) return wrong(scope, field, "a list of strings");
  return value;
}

/** A whole number from `min` to `max`, inclusive. */
export function readInteger(object: JsonObject, field: string, min: number, max: number, scope: FieldScope): number | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    return wrong(scope, field, `a whole number from ${min} to ${max}`);
  }
  return value;
}

/** Keys an `env` map may carry, the format's rule. */
export const EVAL_ENV_KEY_PATTERN = /^EVAL_[A-Z0-9_]*$/;

/**
 * An `env` map. A scalar value is kept as its string form, since YAML reads
 * `EVAL_LEVEL: 2` as a number and the child process sees text either way.
 */
export function readEnv(object: JsonObject, field: string, scope: FieldScope): Readonly<Record<string, string>> | undefined {
  const value = object[field];
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) return wrong(scope, field, "a map of EVAL_* names to values");
  const env: Record<string, string> = {};
  let ok = true;
  for (const [key, item] of Object.entries(value)) {
    if (!EVAL_ENV_KEY_PATTERN.test(key)) {
      scope.findings.add(scope.invalid, scope.path, `${scope.label}${field} key '${key}' must match EVAL_[A-Z0-9_]*`);
      ok = false;
      continue;
    }
    if (typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean") {
      wrong(scope, `${field}.${key}`, "a string, number or boolean");
      ok = false;
      continue;
    }
    env[key] = String(item);
  }
  return ok ? env : undefined;
}

/** The case format version this reader reads. */
export const EVAL_SCHEMA_VERSION = "1.1";

/**
 * `schema_version`: `"1.1"`, or the number YAML reads from an unquoted
 * `1.1`. `true` when it is that version, `false` after a finding.
 */
export function checkSchemaVersion(value: unknown, scope: FieldScope): boolean {
  if (value === EVAL_SCHEMA_VERSION || value === 1.1) return true;
  scope.findings.add(
    "eval-schema-version-unsupported",
    scope.path,
    `schema_version ${JSON.stringify(value)} is not supported; this reader reads "${EVAL_SCHEMA_VERSION}"`,
  );
  return false;
}

/** The compile error of a JavaScript regex, or `undefined` when it compiles. */
export function regexError(pattern: string, flags: string): string | undefined {
  try {
    new RegExp(pattern, flags);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
