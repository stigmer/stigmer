/**
 * One grader, from a `graders/<name>.md` file's frontmatter and body or a
 * `case.yaml` `graders:` entry, into the normalised `EvalGrader`.
 *
 * The keys are the format's: `type`, `weight` and `arm` for every grader,
 * plus the options of its type, and `name` on a `case.yaml` entry. A key
 * outside that set, or a value of the wrong type, is `eval-grader-invalid`
 * and the case does not load: a grader read leniently is a different check
 * from the one the author wrote, and a score built on it is wrong.
 *
 * In the `.md` layout the body carries the text a grader needs most: the
 * rubric of an `llm` or `baseline` grader, or a `regex` grader's pattern.
 * A frontmatter key of the same name wins when both are present, so a
 * file that sets `criteria:` and also keeps notes in its body grades on
 * the key. The body of a criteria is trimmed (a judge reads it as prose);
 * a pattern from the body is trimmed too, since its trailing newline would
 * otherwise be part of the expression.
 *
 * Defaults the format documents are applied here: weight 1, regex flags
 * empty and `match: contains`, `target`/`focus` `last_message`,
 * `tool_used` min 1 and max unlimited, `file_exists` `exists: true`. A
 * `file_exists` `path` must be a well-formed glob (glob.ts).
 */

import { isJsonObject, type JsonObject } from "../documents.js";
import {
  type FieldScope,
  quote,
  readNonEmptyString,
  readString,
  regexError,
  unknownKeys,
  wrong,
} from "./fields.js";
import { globError } from "./glob.js";
import type { EvalFocus, EvalGrader, EvalGraderArm, EvalGraderCheck, EvalGraderType, EvalToolRef } from "./types.js";

const COMMON_KEYS = ["type", "weight", "arm"] as const;

/** Each type's own options, the format's "Grader types" table. */
const TYPE_KEYS: Readonly<Record<EvalGraderType, readonly string[]>> = {
  regex: ["pattern", "flags", "match", "target"],
  tool_used: ["tool", "input_match", "min", "max"],
  tool_order: ["before", "after"],
  file_exists: ["path", "exists"],
  llm: ["criteria", "focus"],
  baseline: ["baseline_file", "criteria"],
};

const GRADER_TYPES = Object.keys(TYPE_KEYS) as readonly EvalGraderType[];

function isGraderType(value: unknown): value is EvalGraderType {
  return typeof value === "string" && (GRADER_TYPES as readonly string[]).includes(value);
}

/** What one grader is read from. */
export interface GraderSource {
  /** The grader's name: the file stem, or the entry's `name`. */
  readonly name: string;
  /** The file that declared it, plugin-relative. */
  readonly path: string;
  /** The frontmatter or the entry, `name` removed. */
  readonly fields: JsonObject;
  /** A `.md` file's body; `undefined` for a `case.yaml` entry. */
  readonly body?: string;
  /** The case's files, to check a `baseline_file` is one of them. */
  readonly caseDir: string;
  readonly caseFiles: ReadonlySet<string>;
}

/** The grader, or `undefined` after at least one finding in `scope`. */
export function readGrader(source: GraderSource, scope: FieldScope, noun: string): EvalGrader | undefined {
  const { fields } = source;
  const before = scope.findings.list.length;
  const type = fields["type"];
  if (type === undefined) {
    scope.findings.add(scope.invalid, scope.path, `${scope.label}type is required (one of ${GRADER_TYPES.join(", ")})`);
    return undefined;
  }
  if (!isGraderType(type)) {
    return wrong(scope, "type", `one of ${GRADER_TYPES.join(", ")}`);
  }
  unknownKeys(fields, new Set<string>([...COMMON_KEYS, ...TYPE_KEYS[type]]), scope, scope.invalid, noun);

  const weight = readWeight(fields, scope);
  const arm = readArm(fields, scope);
  const check = readCheck(type, source, scope);
  if (scope.findings.list.length > before || check === undefined) return undefined;
  return {
    name: source.name,
    path: source.path,
    weight: weight ?? 1,
    ...(arm !== undefined && { arm }),
    check,
  };
}

function readWeight(fields: JsonObject, scope: FieldScope): number | undefined {
  const value = fields["weight"];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return wrong(scope, "weight", "a positive number");
  return value;
}

function readArm(fields: JsonObject, scope: FieldScope): EvalGraderArm | undefined {
  const value = fields["arm"];
  if (value === undefined) return undefined;
  if (value !== "with-only" && value !== "both") return wrong(scope, "arm", "'with-only' or 'both'");
  return value;
}

function readCheck(type: EvalGraderType, source: GraderSource, scope: FieldScope): EvalGraderCheck | undefined {
  const { fields } = source;
  switch (type) {
    case "regex":
      return readRegex(source, scope);
    case "tool_used": {
      const tool = readNonEmptyString(fields, "tool", scope);
      const inputMatch = readPattern(fields, "input_match", scope);
      const writtenMin = readCount(fields, "min", scope);
      const max = readCount(fields, "max", scope);
      if (tool === undefined) return required(scope, "tool", fields);
      // A max alone lowers the default min of 1 to it, so `max: 0` reads as
      // "never called" rather than a range nothing can satisfy.
      const min = writtenMin ?? (max === undefined ? 1 : Math.min(1, max));
      if (max !== undefined && min > max) return wrong(scope, "min", `at most max (${max})`);
      return {
        type,
        tool,
        ...(inputMatch !== undefined && { inputMatch }),
        min,
        ...(max !== undefined && { max }),
      };
    }
    case "tool_order": {
      const before = readToolRef(fields, "before", scope);
      const after = readToolRef(fields, "after", scope);
      if (before === undefined) return required(scope, "before", fields);
      if (after === undefined) return required(scope, "after", fields);
      return { type, before, after };
    }
    case "file_exists": {
      const path = readNonEmptyString(fields, "path", scope);
      const exists = fields["exists"];
      if (exists !== undefined && typeof exists !== "boolean") return wrong(scope, "exists", "true or false");
      if (path === undefined) return required(scope, "path", fields);
      const malformed = globError(path);
      if (malformed !== undefined) return wrong(scope, "path", `a glob (${malformed})`);
      return { type, path, exists: exists ?? true };
    }
    case "llm": {
      const criteria = readCriteria(source, scope);
      const focus = readFocus(fields["focus"], "focus", scope);
      if (criteria === undefined || focus === undefined) return undefined;
      return { type, criteria, focus };
    }
    case "baseline": {
      const criteria = readCriteria(source, scope);
      const baselineFile = readNonEmptyString(fields, "baseline_file", scope);
      if (baselineFile === undefined) return required(scope, "baseline_file", fields);
      if (!source.caseFiles.has(`${source.caseDir}/${baselineFile.replace(/^\.\//, "")}`)) {
        return wrong(scope, "baseline_file", `a file in the case directory (${quote(baselineFile)} is not)`);
      }
      if (criteria === undefined) return undefined;
      return { type, baselineFile, criteria };
    }
    /* v8 ignore start -- @preserve: the never arm; readGrader admits only GRADER_TYPES, so no type reaches it */
    default: {
      const exhaustive: never = type;
      throw new Error(`unknown grader type ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

/** A required option that is absent; a present one of the wrong type already reported itself. */
function required(scope: FieldScope, field: string, fields: JsonObject): undefined {
  if (fields[field] === undefined) scope.findings.add(scope.invalid, scope.path, `${scope.label}${field} is required`);
  return undefined;
}

function readRegex(source: GraderSource, scope: FieldScope): EvalGraderCheck | undefined {
  const { fields } = source;
  const flags = readString(fields, "flags", scope) ?? "";
  const fromBody = source.body?.trim();
  const pattern =
    fields["pattern"] !== undefined ? readNonEmptyString(fields, "pattern", scope) : fromBody === "" ? undefined : fromBody;
  const match = readMatch(fields["match"], scope);
  const target = readFocus(fields["target"], "target", scope);
  if (pattern === undefined) {
    if (fields["pattern"] === undefined) {
      scope.findings.add(scope.invalid, scope.path, `${scope.label}pattern is required`);
    }
    return undefined;
  }
  if (regexError("", flags) !== undefined) return wrong(scope, "flags", "JavaScript regular expression flags, such as 'i'");
  const error = regexError(pattern, flags);
  if (error !== undefined) return wrong(scope, "pattern", `a JavaScript regular expression (${error})`);
  if (match === undefined || target === undefined) return undefined;
  return { type: "regex", pattern, flags, match, target };
}

type RegexMatch = Extract<EvalGraderCheck, { type: "regex" }>["match"];

const COUNT_MATCH = /^count:(\d+)$/;

function readMatch(value: unknown, scope: FieldScope): RegexMatch | undefined {
  if (value === undefined || value === "contains") return { kind: "contains" };
  if (value === "not_contains") return { kind: "not_contains" };
  const count = typeof value === "string" ? COUNT_MATCH.exec(value) : null;
  if (count?.[1] !== undefined) return { kind: "count", count: Number(count[1]) };
  return wrong(scope, "match", "'contains', 'not_contains' or \"count:N\"");
}

const NAMED_FOCUS: Readonly<Record<string, EvalFocus>> = {
  last_message: { kind: "last_message" },
  trace: { kind: "trace" },
  files: { kind: "files" },
  mock_calls: { kind: "mock_calls" },
};

/** A `target` or `focus`; absent is `last_message`. */
function readFocus(value: unknown, field: string, scope: FieldScope): EvalFocus | undefined {
  if (value === undefined) return { kind: "last_message" };
  const expected = "last_message, trace, files, mock_calls, or { source: file, path: <path> }";
  // Own keys only: an author's `toString` or `constructor` is not a focus.
  if (typeof value === "string") return Object.hasOwn(NAMED_FOCUS, value) ? NAMED_FOCUS[value] : wrong(scope, field, expected);
  if (!isJsonObject(value)) return wrong(scope, field, expected);
  const keys = Object.keys(value);
  const path = value["path"];
  if (value["source"] !== "file" || typeof path !== "string" || path.trim() === "" || keys.some((k) => k !== "source" && k !== "path")) {
    return wrong(scope, field, expected);
  }
  return { kind: "file", path };
}

/** A `tool_order` side: a tool name, or `{ tool, input_match }`. */
function readToolRef(fields: JsonObject, field: string, scope: FieldScope): EvalToolRef | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (typeof value === "string" && value.trim() !== "") return { tool: value };
  const expected = "a tool name or { tool, input_match }";
  if (!isJsonObject(value)) return wrong(scope, field, expected);
  const tool = value["tool"];
  if (typeof tool !== "string" || tool.trim() === "" || Object.keys(value).some((k) => k !== "tool" && k !== "input_match")) {
    return wrong(scope, field, expected);
  }
  const inputMatch = readPattern(value, "input_match", { ...scope, label: `${scope.label}${field}.` });
  if (value["input_match"] !== undefined && inputMatch === undefined) return undefined;
  return { tool, ...(inputMatch !== undefined && { inputMatch }) };
}

/** An `input_match` regex, checked to compile. */
function readPattern(fields: JsonObject, field: string, scope: FieldScope): string | undefined {
  const pattern = readString(fields, field, scope);
  if (pattern === undefined) return undefined;
  const error = regexError(pattern, "");
  if (error !== undefined) return wrong(scope, field, `a JavaScript regular expression (${error})`);
  return pattern;
}

function readCount(fields: JsonObject, field: string, scope: FieldScope): number | undefined {
  const value = fields[field];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return wrong(scope, field, "a whole number, 0 or more");
  return value;
}

/** The rubric: the `criteria` key, else a `.md` file's body. */
function readCriteria(source: GraderSource, scope: FieldScope): string | undefined {
  const { fields } = source;
  if (fields["criteria"] !== undefined) {
    const criteria = readNonEmptyString(fields, "criteria", scope);
    return criteria?.trim();
  }
  const body = source.body?.trim() ?? "";
  if (body !== "") return body;
  const where = source.body === undefined ? "" : " (the file's body, or a criteria key)";
  scope.findings.add(scope.invalid, scope.path, `${scope.label}criteria is required${where}`);
  return undefined;
}
