/**
 * A mock's `expect:` guard: what a call's input must look like, checked
 * before the mock answers. A call that violates it stops the try.
 *
 * The guard is a map from dotted input paths (`issue.title`) to one rule:
 *  - a type name: `string`, `number`, `boolean`, `array` or `object`;
 *  - a `/regex/flags` string, in the format's small dialect (below);
 *  - any other string, number, boolean or null: the value must equal it;
 *  - a list of such literals: the value must equal one of them.
 * A path the input does not carry is a violation.
 *
 * The regex dialect is the format's: literal characters, `.`, the escapes
 * `\d \w \s \D \W \S` and an escaped punctuation character, classes such
 * as `[a-z]` or `[^0-9]`, the quantifiers `*`, `+`, `?`, `{m}`, `{m,}` and
 * `{m,n}` on one character, escape or class, an optional `^` first and `$`
 * last, and the flags `i` and `s` only. Anything else (a group, an
 * alternation, a backreference, a lookaround, another flag) is refused at
 * compile with a sentence naming the pattern, which the suite reader turns
 * into the case's load error.
 *
 * Matching is linear: the pattern is expanded into a sequence of units
 * (a quantifier's minimum as required units, the rest optional, an
 * unbounded tail as one repeating unit) and simulated as a set of
 * positions over the value, so a value of length n costs n times the
 * units, never a backtracking blow-up. The expansion is capped at
 * EXPECT_MAX_UNITS, so a `{m,n}` cannot make a pattern large.
 *
 * Unlike Claude Code, a value is matched whole, whatever its length: the
 * format bounds the length a pattern checks without documenting the bound,
 * and the matcher here has no need for one. The guide states it.
 */

/** The type names a rule may give. */
const TYPE_NAMES = ["string", "number", "boolean", "array", "object"] as const;
type TypeName = (typeof TYPE_NAMES)[number];

/** The most units a pattern may expand to. */
export const EXPECT_MAX_UNITS = 1024;

/** The most characters a pattern may hold. */
export const EXPECT_MAX_PATTERN_LENGTH = 512;

/** One compiled rule of a guard. */
type Rule =
  | { readonly kind: "type"; readonly type: TypeName }
  | { readonly kind: "regex"; readonly source: string; readonly pattern: CompiledPattern }
  | { readonly kind: "literal"; readonly value: Literal }
  | { readonly kind: "one-of"; readonly values: readonly Literal[] };

type Literal = string | number | boolean | null;

/** A compiled guard: each dotted path and its rule, in the order written. */
export interface CompiledExpect {
  readonly rules: readonly { readonly path: string; readonly rule: Rule }[];
}

/** A compiled guard, or why the block is not one. */
export type ExpectCompile =
  | { readonly ok: true; readonly expect: CompiledExpect }
  | { readonly ok: false; readonly error: string };

/**
 * Compile an `expect:` block as parsed from YAML (or its JSON form, as a
 * run carries it). Refuses a block that is not a map, a path that is not
 * dotted names, and any rule outside the list in the module header.
 */
export function compileExpect(block: unknown): ExpectCompile {
  if (!isRecord(block)) return { ok: false, error: "expect must be a map from input paths to rules" };
  const rules: { path: string; rule: Rule }[] = [];
  for (const [path, value] of Object.entries(block)) {
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(path)) {
      return { ok: false, error: `expect path '${path}' is not a dotted input path` };
    }
    const rule = ruleOf(value);
    if (typeof rule === "string") return { ok: false, error: `expect.${path}: ${rule}` };
    rules.push({ path, rule });
  }
  return { ok: true, expect: { rules } };
}

/** Why `input` violates the guard, as one sentence; `undefined` when it holds. */
export function checkExpect(expect: CompiledExpect, input: unknown): string | undefined {
  for (const { path, rule } of expect.rules) {
    const found = valueAt(input, path);
    if (!found.present) return `input.${path} is missing`;
    const violation = violationOf(rule, found.value);
    if (violation !== undefined) return `input.${path} ${violation}`;
  }
  return undefined;
}

function ruleOf(value: unknown): Rule | string {
  if (Array.isArray(value)) {
    const values: Literal[] = [];
    for (const item of value) {
      if (!isLiteral(item)) return "a list must hold literals only";
      values.push(item);
    }
    if (values.length === 0) return "a list must name at least one value";
    return { kind: "one-of", values };
  }
  if (typeof value === "string") {
    if ((TYPE_NAMES as readonly string[]).includes(value)) return { kind: "type", type: value as TypeName };
    const regex = /^\/(.*)\/([a-z]*)$/s.exec(value);
    if (regex !== null) {
      const compiled = compilePattern(regex[1] ?? "", regex[2] ?? "");
      if (typeof compiled === "string") return `the pattern ${value} ${compiled}`;
      return { kind: "regex", source: value, pattern: compiled };
    }
    return { kind: "literal", value };
  }
  if (isLiteral(value)) return { kind: "literal", value };
  return "a rule must be a type name, a /regex/, a literal or a list of literals";
}

function violationOf(rule: Rule, value: unknown): string | undefined {
  switch (rule.kind) {
    case "type":
      return typeOf(value) === rule.type ? undefined : `must be ${article(rule.type)}`;
    case "regex":
      return matchPattern(rule.pattern, textOf(value)) ? undefined : `must match ${rule.source}`;
    case "literal":
      return value === rule.value ? undefined : `must be ${JSON.stringify(rule.value)}`;
    case "one-of":
      return rule.values.some((v) => v === value)
        ? undefined
        : `must be one of ${rule.values.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")}`;
  }
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function article(type: TypeName): string {
  return type === "array" || type === "object" ? `an ${type}` : `a ${type}`;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value) ?? "";
}

function valueAt(input: unknown, path: string): { readonly present: boolean; readonly value?: unknown } {
  let current: unknown = input;
  for (const key of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, key)) return { present: false };
    current = current[key];
  }
  return { present: true, value: current };
}

// --- The pattern dialect -------------------------------------------------

/** What one unit consumes: one character. */
type Atom =
  | { readonly kind: "char"; readonly char: string }
  | { readonly kind: "any" }
  | { readonly kind: "class"; readonly negated: boolean; readonly items: readonly ClassItem[] };

type ClassItem =
  | { readonly kind: "range"; readonly from: number; readonly to: number }
  | { readonly kind: "escape"; readonly letter: string };

/** One step of the expanded pattern: required, optional, or repeating any number of times. */
interface Unit {
  readonly atom: Atom;
  readonly mode: "one" | "optional" | "star";
}

/** A pattern compiled for {@link matchPattern}. */
export interface CompiledPattern {
  readonly units: readonly Unit[];
  readonly anchoredStart: boolean;
  readonly anchoredEnd: boolean;
  readonly ignoreCase: boolean;
  readonly dotAll: boolean;
}

/** Compile a pattern in the dialect, or say why it is outside it. */
export function compilePattern(source: string, flags: string): CompiledPattern | string {
  if ([...flags].some((f) => f !== "i" && f !== "s") || new Set(flags).size !== flags.length) {
    return `uses a flag other than i and s`;
  }
  if (source.length > EXPECT_MAX_PATTERN_LENGTH) {
    return `is longer than ${EXPECT_MAX_PATTERN_LENGTH} characters`;
  }
  const chars = [...source];
  let i = 0;
  const anchoredStart = chars[0] === "^";
  if (anchoredStart) i = 1;
  let end = chars.length;
  const anchoredEnd = end > i && chars[end - 1] === "$" && !escapedAt(chars, end - 1);
  if (anchoredEnd) end -= 1;
  const units: Unit[] = [];
  while (i < end) {
    const read = atomAt(chars, i, end);
    if (typeof read === "string") return read;
    i = read.next;
    const quantifier = quantifierAt(chars, i, end);
    if (typeof quantifier === "string") return quantifier;
    i = quantifier.next;
    for (let n = 0; n < quantifier.min; n++) units.push({ atom: read.atom, mode: "one" });
    if (quantifier.max === Infinity) {
      units.push({ atom: read.atom, mode: "star" });
    } else {
      for (let n = quantifier.min; n < quantifier.max; n++) units.push({ atom: read.atom, mode: "optional" });
    }
    if (units.length > EXPECT_MAX_UNITS) return `expands to more than ${EXPECT_MAX_UNITS} steps`;
  }
  return { units, anchoredStart, anchoredEnd, ignoreCase: flags.includes("i"), dotAll: flags.includes("s") };
}

function escapedAt(chars: readonly string[], index: number): boolean {
  let slashes = 0;
  for (let j = index - 1; j >= 0 && chars[j] === "\\"; j--) slashes++;
  return slashes % 2 === 1;
}

const ESCAPE_CLASSES = new Set(["d", "w", "s", "D", "W", "S"]);
const SPECIALS = new Set(["(", ")", "|", "{", "}", "*", "+", "?", "^", "$"]);

function atomAt(
  chars: readonly string[],
  i: number,
  end: number,
): { readonly atom: Atom; readonly next: number } | string {
  const c = chars[i] ?? "";
  if (c === "\\") {
    const e = chars[i + 1];
    if (e === undefined || i + 1 >= end) return "ends with a lone backslash";
    if (ESCAPE_CLASSES.has(e)) return { atom: { kind: "class", negated: false, items: [{ kind: "escape", letter: e }] }, next: i + 2 };
    if (/^[^A-Za-z0-9]$/.test(e)) return { atom: { kind: "char", char: e }, next: i + 2 };
    if (e === "n") return { atom: { kind: "char", char: "\n" }, next: i + 2 };
    if (e === "t") return { atom: { kind: "char", char: "\t" }, next: i + 2 };
    return `uses the escape \\${e}, which the dialect does not have`;
  }
  if (c === "[") return classAt(chars, i, end);
  if (c === ".") return { atom: { kind: "any" }, next: i + 1 };
  if (c === "(" || c === ")") return "uses a group";
  if (c === "|") return "uses an alternation";
  if (SPECIALS.has(c)) return `has a ${c} with nothing to apply to`;
  return { atom: { kind: "char", char: c }, next: i + 1 };
}

function classAt(
  chars: readonly string[],
  start: number,
  end: number,
): { readonly atom: Atom; readonly next: number } | string {
  let i = start + 1;
  const negated = chars[i] === "^";
  if (negated) i++;
  const items: ClassItem[] = [];
  let first = true;
  while (i < end) {
    const c = chars[i] ?? "";
    if (c === "]" && !first) return { atom: { kind: "class", negated, items }, next: i + 1 };
    first = false;
    let from: number;
    if (c === "\\") {
      const e = chars[i + 1];
      if (e === undefined || i + 1 >= end) return "has a class that never closes";
      if (ESCAPE_CLASSES.has(e)) {
        items.push({ kind: "escape", letter: e });
        i += 2;
        continue;
      }
      from = (e === "n" ? "\n" : e === "t" ? "\t" : e).codePointAt(0) ?? 0;
      i += 2;
    } else {
      from = c.codePointAt(0) ?? 0;
      i += 1;
    }
    if (chars[i] === "-" && i + 1 < end && chars[i + 1] !== "]") {
      const t = chars[i + 1] ?? "";
      const to = (t === "\\" ? (chars[i + 2] ?? "") : t).codePointAt(0) ?? 0;
      if (to < from) return "has a reversed range in a class";
      items.push({ kind: "range", from, to });
      i += t === "\\" ? 3 : 2;
    } else {
      items.push({ kind: "range", from, to: from });
    }
  }
  return "has a class that never closes";
}

function quantifierAt(
  chars: readonly string[],
  i: number,
  end: number,
): { readonly min: number; readonly max: number; readonly next: number } | string {
  const c = chars[i];
  let read: { min: number; max: number; next: number } = { min: 1, max: 1, next: i };
  if (i < end && c === "*") read = { min: 0, max: Infinity, next: i + 1 };
  else if (i < end && c === "+") read = { min: 1, max: Infinity, next: i + 1 };
  else if (i < end && c === "?") read = { min: 0, max: 1, next: i + 1 };
  else if (i < end && c === "{") {
    let j = i + 1;
    let body = "";
    while (j < end && chars[j] !== "}") body += chars[j++];
    const m = /^(\d+)(,(\d*))?$/.exec(body);
    if (j >= end || m === null) return "has a { that is not a {m,n} quantifier";
    const min = Number(m[1]);
    const max = m[2] === undefined ? min : m[3] === "" ? Infinity : Number(m[3]);
    if (max < min) return "has a {m,n} quantifier whose n is below its m";
    read = { min, max, next: j + 1 };
  }
  const after = chars[read.next];
  if (read.next < end && read.next !== i && (after === "*" || after === "+" || after === "?" || after === "{")) {
    return "quantifies a quantifier";
  }
  return read;
}

/** Whether `pattern` is found in `value` (anywhere, unless anchored). */
export function matchPattern(pattern: CompiledPattern, value: string): boolean {
  const text = [...value];
  const n = pattern.units.length;
  let states = closure(new Set([0]), pattern.units);
  for (let pos = 0; pos <= text.length; pos++) {
    if (states.has(n) && (!pattern.anchoredEnd || pos === text.length)) return true;
    if (pos === text.length) break;
    const c = text[pos] ?? "";
    const next = new Set<number>();
    for (const s of states) {
      const unit = pattern.units[s];
      if (unit === undefined || !atomMatches(unit.atom, c, pattern)) continue;
      next.add(unit.mode === "star" ? s : s + 1);
    }
    if (!pattern.anchoredStart) next.add(0);
    states = closure(next, pattern.units);
    if (states.size === 0) return false;
  }
  return false;
}

/** States reachable by skipping optional and repeating units. */
function closure(states: Set<number>, units: readonly Unit[]): Set<number> {
  const out = new Set<number>();
  for (const start of states) {
    let s = start;
    out.add(s);
    while (s < units.length && units[s]?.mode !== "one") {
      s += 1;
      out.add(s);
    }
  }
  return out;
}

function atomMatches(atom: Atom, c: string, pattern: CompiledPattern): boolean {
  switch (atom.kind) {
    case "any":
      return pattern.dotAll || (c !== "\n" && c !== "\r");
    case "char":
      return pattern.ignoreCase ? c.toLowerCase() === atom.char.toLowerCase() : c === atom.char;
    case "class": {
      const hit = atom.items.some((item) => classItemMatches(item, c, pattern.ignoreCase));
      return atom.negated ? !hit : hit;
    }
  }
}

function classItemMatches(item: ClassItem, c: string, ignoreCase: boolean): boolean {
  if (item.kind === "escape") {
    const hit =
      item.letter.toLowerCase() === "d" ? /\d/.test(c) : item.letter.toLowerCase() === "w" ? /\w/.test(c) : /\s/.test(c);
    return item.letter === item.letter.toUpperCase() ? !hit : hit;
  }
  const inRange = (ch: string): boolean => {
    const code = ch.codePointAt(0) ?? -1;
    return code >= item.from && code <= item.to;
  };
  return inRange(c) || (ignoreCase && (inRange(c.toLowerCase()) || inRange(c.toUpperCase())));
}

function isLiteral(value: unknown): value is Literal {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
