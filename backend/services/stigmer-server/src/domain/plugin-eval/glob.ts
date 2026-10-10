/**
 * The one glob matcher plugin evals use: a `file_exists` grader's `path`
 * against the files a try created, and an eval's `case_glob` against its
 * case names. A glob is compiled once to token lists and matched by a
 * dynamic program over (token, input position), so a match costs at most
 * the alternatives times the tokens times the input's length, whatever the
 * glob: no regular expression is built, so no author or client glob can
 * make a match backtrack, and the matcher needs no deadline.
 *
 * The grammar:
 *
 *   - `*`: a run of characters; in a path it stays inside one segment
 *     (never `/`);
 *   - `**`: in a path, any run of characters across segments, and `**`
 *     followed by `/` also no directory at all (so `src`, `**`, `/x.ts`
 *     written together matches `src/x.ts`); in a case name, the same as
 *     `*`;
 *   - `?`: one character (in a path, not `/`);
 *   - `[...]`: one character of a class, with ranges (`a-z`) and `!` or `^`
 *     first to negate; a `]` right after the opening (or the negation) is
 *     a member; in a path a class never matches `/`; a class holds at most
 *     GLOB_MAX_CLASS_ITEMS ranges or characters;
 *   - `{a,b}`: alternatives, which may nest and hold any of the above; the
 *     glob expands to at most GLOB_MAX_ALTERNATIVES of them, braces nest at
 *     most GLOB_MAX_BRACE_DEPTH deep;
 *   - everything else, a `}` with no `{` and a `,` outside braces
 *     included, is literal.
 *
 * A glob holds at most GLOB_MAX_LENGTH characters and expands to at most
 * GLOB_MAX_TOKENS tokens summed over its alternatives (a `/` right after
 * `**` counted as its own token, so the count is the same in either
 * mode, and a class counted once per range or character it holds, since
 * a character is tested against each of them), which bounds a match's
 * cost by GLOB_MAX_TOKENS times the input's length: an author's `file_exists` grader runs on the server's own
 * thread, once per file a try created, so its grader also bounds the
 * work per try by `tokens` (graders/file-exists.ts).
 *
 * A malformed glob (too long, a class or a brace never closed, a reversed
 * range, a class too large, too many alternatives or tokens, braces nested
 * too deep) is an
 * error value, never a throw. The plugin library refuses the same globs when it reads a suite
 * (`globError` in @stigmer/plugin-package); the tests pin both readers to
 * one table.
 *
 * Proven by __tests__/glob.test.ts.
 */

/** The most alternatives a glob's braces may expand to. */
export const GLOB_MAX_ALTERNATIVES = 64;

/** The deepest braces may nest. */
export const GLOB_MAX_BRACE_DEPTH = 16;

/** The most characters (code points) a glob may hold. */
export const GLOB_MAX_LENGTH = 1024;

/** The most tokens a glob may expand to, summed over its alternatives. */
export const GLOB_MAX_TOKENS = 4096;

/** The most ranges or characters one `[...]` class may hold. */
export const GLOB_MAX_CLASS_ITEMS = 32;

/** Whether `*` and `?` stay inside a path segment. */
export type GlobMode = "path" | "name";

/** A compiled glob, or why it is not one. */
export type CompiledGlob =
  | {
      readonly ok: true;
      matches(input: string): boolean;
      /** The tokens of every alternative, in all, a class weighed by its ranges: one match costs at most this times the input's length. */
      readonly tokens: number;
    }
  | { readonly ok: false; readonly error: string };

type Token =
  | { readonly kind: "literal"; readonly char: string }
  | { readonly kind: "one" }
  | { readonly kind: "class"; readonly negated: boolean; readonly ranges: ReadonlyArray<readonly [number, number]> }
  | { readonly kind: "star" }
  | { readonly kind: "globstar" }
  | { readonly kind: "globstar-dir" };

type Node = Token | { readonly kind: "group"; readonly alternatives: ReadonlyArray<ReadonlyArray<Node>> };

class GlobSyntaxError {
  constructor(readonly message: string) {}
}

export function compileGlob(glob: string, mode: GlobMode): CompiledGlob {
  if (longerThanTheCap(glob)) {
    return { ok: false, error: `it is longer than ${GLOB_MAX_LENGTH} characters` };
  }
  let alternatives: Token[][];
  try {
    const parser = new Parser(Array.from(glob), mode);
    const sequence = parser.sequence(0);
    const size = sizeOf(sequence);
    if (size.count > GLOB_MAX_ALTERNATIVES) {
      throw new GlobSyntaxError(`it expands to more than ${GLOB_MAX_ALTERNATIVES} alternatives`);
    }
    if (size.tokens > GLOB_MAX_TOKENS) {
      throw new GlobSyntaxError(`it expands to more than ${GLOB_MAX_TOKENS} tokens`);
    }
    alternatives = expand(sequence).map((tokens) => collapseStars(tokens, mode));
  } catch (error) {
    if (error instanceof GlobSyntaxError) {
      return { ok: false, error: error.message };
    }
    /* v8 ignore next -- @preserve: the parser throws nothing else; a defect surfaces rather than reading as a malformed glob */
    throw error;
  }
  return {
    ok: true,
    tokens: alternatives.reduce((sum, tokens) => sum + tokens.reduce((weight, token) => weight + tokenWeight(token), 0), 0),
    matches: (input) => {
      const chars = Array.from(input);
      return alternatives.some((tokens) => matchTokens(tokens, chars, mode));
    },
  };
}

/** The glob's parser over its characters (code points). */
class Parser {
  private pos = 0;

  constructor(
    private readonly chars: ReadonlyArray<string>,
    private readonly mode: GlobMode,
  ) {}

  /** A sequence up to the end, or, inside braces, up to its `,` or `}`. */
  sequence(depth: number): Node[] {
    const nodes: Node[] = [];
    while (this.pos < this.chars.length) {
      const char = this.chars[this.pos] ?? "";
      if (depth > 0 && (char === "," || char === "}")) {
        return nodes;
      }
      switch (char) {
        case "*":
          nodes.push(this.stars());
          break;
        case "?":
          this.pos++;
          nodes.push({ kind: "one" });
          break;
        case "[":
          nodes.push(this.charClass());
          break;
        case "{":
          nodes.push(this.group(depth + 1));
          break;
        default:
          this.pos++;
          nodes.push({ kind: "literal", char });
      }
    }
    return nodes;
  }

  private stars(): Token {
    let count = 0;
    while (this.chars[this.pos] === "*") {
      count++;
      this.pos++;
    }
    if (count === 1 || this.mode === "name") {
      return { kind: "star" };
    }
    if (this.chars[this.pos] === "/") {
      this.pos++;
      return { kind: "globstar-dir" };
    }
    return { kind: "globstar" };
  }

  private charClass(): Token {
    const open = this.pos;
    let i = open + 1;
    let negated = false;
    if (this.chars[i] === "!" || this.chars[i] === "^") {
      negated = true;
      i++;
    }
    const ranges: Array<readonly [number, number]> = [];
    let first = true;
    for (;;) {
      const char = this.chars[i];
      if (char === undefined) {
        throw new GlobSyntaxError(`'[' at ${open} is never closed`);
      }
      if (char === "]" && !first) {
        break;
      }
      first = false;
      const after = this.chars[i + 1];
      const end = this.chars[i + 2];
      if (after === "-" && end !== undefined && end !== "]") {
        const low = char.codePointAt(0) ?? 0;
        const high = end.codePointAt(0) ?? 0;
        if (low > high) {
          throw new GlobSyntaxError(`range '${char}-${end}' is reversed`);
        }
        ranges.push([low, high]);
        i += 3;
      } else {
        const point = char.codePointAt(0) ?? 0;
        ranges.push([point, point]);
        i++;
      }
      if (ranges.length > GLOB_MAX_CLASS_ITEMS) {
        throw new GlobSyntaxError(`'[' at ${open} holds more than ${GLOB_MAX_CLASS_ITEMS} ranges or characters`);
      }
    }
    this.pos = i + 1;
    return { kind: "class", negated, ranges };
  }

  private group(depth: number): Node {
    const open = this.pos;
    if (depth > GLOB_MAX_BRACE_DEPTH) {
      throw new GlobSyntaxError(`braces are nested more than ${GLOB_MAX_BRACE_DEPTH} deep`);
    }
    this.pos++;
    const alternatives: Node[][] = [];
    for (;;) {
      alternatives.push(this.sequence(depth));
      const char = this.chars[this.pos];
      if (char === undefined) {
        throw new GlobSyntaxError(`'{' at ${open} is never closed`);
      }
      this.pos++;
      if (char === "}") {
        return { kind: "group", alternatives };
      }
    }
  }
}

/** Whether `glob` holds more than GLOB_MAX_LENGTH code points, counting no further. */
function longerThanTheCap(glob: string): boolean {
  if (glob.length <= GLOB_MAX_LENGTH) {
    return false;
  }
  let points = 0;
  for (const _ of glob) {
    if (++points > GLOB_MAX_LENGTH) {
      return true;
    }
  }
  return false;
}

/** A sequence's alternatives and their tokens in all, each capped one past its limit. */
interface GlobSize {
  readonly count: number;
  readonly tokens: number;
}

/**
 * How many alternatives `nodes` expands to and how many tokens they hold
 * in all, without expanding them: n heads of t tokens in all followed by
 * m tails of s make n*m alternatives of t*m + s*n tokens.
 */
function sizeOf(nodes: ReadonlyArray<Node>): GlobSize {
  const countCap = GLOB_MAX_ALTERNATIVES + 1;
  const tokenCap = GLOB_MAX_TOKENS + 1;
  let count = 1;
  let tokens = 0;
  for (const node of nodes) {
    if (node.kind !== "group") {
      // `**/` in a path is one token that stands for two characters' worth
      // of a name glob (a star and a `/`), so both modes count alike.
      const weight = tokenWeight(node) + (node.kind === "globstar-dir" ? 1 : 0);
      tokens = Math.min(tokens + count * weight, tokenCap);
      continue;
    }
    let sum = 0;
    let sumTokens = 0;
    for (const alternative of node.alternatives) {
      const inner = sizeOf(alternative);
      sum = Math.min(sum + inner.count, countCap);
      sumTokens = Math.min(sumTokens + inner.tokens, tokenCap);
    }
    tokens = Math.min(tokens * sum + sumTokens * count, tokenCap);
    count = Math.min(count * sum, countCap);
  }
  return { count, tokens };
}

/** What one token costs per input character: a class tests the character against each of its ranges. */
function tokenWeight(token: Token): number {
  switch (token.kind) {
    case "class":
      return token.ranges.length;
    case "literal":
    case "one":
    case "star":
    case "globstar":
    case "globstar-dir":
      return 1;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = token;
      return exhausted;
    }
  }
}

/** Every brace-free token list `nodes` stands for (counted first, so bounded). */
function expand(nodes: ReadonlyArray<Node>): Token[][] {
  let lists: Token[][] = [[]];
  for (const node of nodes) {
    if (node.kind !== "group") {
      for (const list of lists) {
        list.push(node);
      }
      continue;
    }
    const tails = node.alternatives.flatMap((alternative) => expand(alternative));
    lists = lists.flatMap((head) => tails.map((tail) => [...head, ...tail]));
  }
  return lists;
}

/** A run of stars that match the same is one star (a brace can join two). */
function collapseStars(tokens: ReadonlyArray<Token>, mode: GlobMode): Token[] {
  const out: Token[] = [];
  for (const token of tokens) {
    const last = out[out.length - 1];
    if (token.kind === "star" && last !== undefined && (last.kind === "star" || (mode === "path" && last.kind === "globstar"))) {
      continue;
    }
    out.push(token);
  }
  return out;
}

/**
 * Whether `tokens` match all of `chars`: `row[j]` is whether the tokens so
 * far match the first `j` characters, one row per token, stopping as soon
 * as no prefix matches.
 */
function matchTokens(tokens: ReadonlyArray<Token>, chars: ReadonlyArray<string>, mode: GlobMode): boolean {
  const n = chars.length;
  let row = new Uint8Array(n + 1);
  let next = new Uint8Array(n + 1);
  row[0] = 1;
  const path = mode === "path";
  for (const token of tokens) {
    next.fill(0);
    let alive = false;
    switch (token.kind) {
      case "star":
        for (let j = 0; j <= n; j++) {
          const extended = j > 0 && next[j - 1] === 1 && !(path && chars[j - 1] === "/");
          if (row[j] === 1 || extended) {
            next[j] = 1;
            alive = true;
          }
        }
        break;
      case "globstar":
        for (let j = 0; j <= n; j++) {
          if (row[j] === 1 || (j > 0 && next[j - 1] === 1)) {
            next[j] = 1;
            alive = true;
          }
        }
        break;
      case "globstar-dir": {
        let earlier = false;
        for (let j = 0; j <= n; j++) {
          if (row[j] === 1 || (earlier && chars[j - 1] === "/")) {
            next[j] = 1;
            alive = true;
          }
          if (row[j] === 1) {
            earlier = true;
          }
        }
        break;
      }
      case "literal":
      case "one":
      case "class":
        for (let j = 0; j < n; j++) {
          if (row[j] === 1 && matchesChar(token, chars[j] ?? "", path)) {
            next[j + 1] = 1;
            alive = true;
          }
        }
        break;
      /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
      default: {
        const exhausted: never = token;
        return exhausted;
      }
    }
    if (!alive) {
      return false;
    }
    [row, next] = [next, row];
  }
  return row[n] === 1;
}

function matchesChar(
  token: Extract<Token, { kind: "literal" | "one" | "class" }>,
  char: string,
  path: boolean,
): boolean {
  switch (token.kind) {
    case "literal":
      return token.char === char;
    case "one":
      return !(path && char === "/");
    case "class": {
      if (path && char === "/") {
        return false;
      }
      const point = char.codePointAt(0) ?? 0;
      const inClass = token.ranges.some(([low, high]) => point >= low && point <= high);
      return inClass !== token.negated;
    }
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = token;
      return exhausted;
    }
  }
}
