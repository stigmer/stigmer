/**
 * Whether a glob is well formed, in the grammar Stigmer's eval graders
 * match with: `*`, `**`, `?`, `[...]` classes with ranges and `!` or `^`
 * negation (a `]` right after the opening or the negation is a member),
 * and `{a,b}` alternatives that may nest, expanding to at most
 * GLOB_MAX_ALTERNATIVES and nesting at most GLOB_MAX_BRACE_DEPTH deep;
 * everything else is literal, a `}` with no `{` included.
 *
 * A glob is also bounded in size, because a match costs its alternatives
 * times their tokens times the path's length: at most GLOB_MAX_LENGTH
 * characters, and at most GLOB_MAX_TOKENS tokens summed over every
 * alternative it expands to. A token is a literal character, a `?`, a
 * class, or a run of stars; a `/` right after `**` counts as its own token,
 * so the count does not depend on whether the glob matches paths or names.
 *
 * Only validity is checked here: the suite reader refuses a `file_exists`
 * grader whose `path` is malformed (too long, a class or a brace never
 * closed, a reversed range, too many alternatives or tokens, braces nested
 * too deep), so the author hears it at push rather than as a try left not
 * graded. The server
 * compiles and matches globs with its own matcher over the same grammar,
 * and its tests pin the two readers to one table, error sentences
 * included.
 */

/** The most alternatives a glob's braces may expand to. */
export const GLOB_MAX_ALTERNATIVES = 64;

/** The deepest braces may nest. */
export const GLOB_MAX_BRACE_DEPTH = 16;

/** The most characters (code points) a glob may hold. */
export const GLOB_MAX_LENGTH = 1024;

/** The most tokens a glob may expand to, summed over its alternatives. */
export const GLOB_MAX_TOKENS = 4096;

/** A sequence's alternatives and their tokens in all, each capped one past its limit. */
interface Size {
  readonly count: number;
  readonly tokens: number;
}

/** Whether `glob` holds more than GLOB_MAX_LENGTH code points, counting no further. */
function tooLong(glob: string): boolean {
  if (glob.length <= GLOB_MAX_LENGTH) return false;
  let points = 0;
  for (const _ of glob) {
    if (++points > GLOB_MAX_LENGTH) return true;
  }
  return false;
}

/** Why `glob` is malformed, or `undefined` when it is a glob. */
export function globError(glob: string): string | undefined {
  if (tooLong(glob)) return `it is longer than ${GLOB_MAX_LENGTH} characters`;
  const chars = Array.from(glob);
  let pos = 0;
  const cap = GLOB_MAX_ALTERNATIVES + 1;
  const tokenCap = GLOB_MAX_TOKENS + 1;

  /** Skips a class from its `[`; the error when it never closes or holds a reversed range. */
  const skipClass = (): string | undefined => {
    const open = pos;
    let i = open + 1;
    if (chars[i] === "!" || chars[i] === "^") i++;
    let first = true;
    for (;;) {
      const char = chars[i];
      if (char === undefined) return `'[' at ${open} is never closed`;
      if (char === "]" && !first) break;
      first = false;
      const end = chars[i + 2];
      if (chars[i + 1] === "-" && end !== undefined && end !== "]") {
        if ((char.codePointAt(0) ?? 0) > (end.codePointAt(0) ?? 0)) return `range '${char}-${end}' is reversed`;
        i += 3;
      } else {
        i++;
      }
    }
    pos = i + 1;
    return undefined;
  };

  /** The size of a sequence, up to the end or, inside braces, its `,` or `}`. */
  const sequence = (depth: number): Size | string => {
    let count = 1;
    let tokens = 0;
    while (pos < chars.length) {
      const char = chars[pos];
      if (depth > 0 && (char === "," || char === "}")) return { count, tokens };
      if (char === "{") {
        const open = pos;
        if (depth + 1 > GLOB_MAX_BRACE_DEPTH) return `braces are nested more than ${GLOB_MAX_BRACE_DEPTH} deep`;
        pos++;
        let sum = 0;
        let sumTokens = 0;
        for (;;) {
          const inner = sequence(depth + 1);
          if (typeof inner === "string") return inner;
          sum = Math.min(sum + inner.count, cap);
          sumTokens = Math.min(sumTokens + inner.tokens, tokenCap);
          const close = chars[pos];
          if (close === undefined) return `'{' at ${open} is never closed`;
          pos++;
          if (close === "}") break;
        }
        // Each head alternative is followed by every tail: n heads of t tokens
        // in all, m tails of s, make n*m alternatives of t*m + s*n tokens.
        tokens = Math.min(tokens * sum + sumTokens * count, tokenCap);
        count = Math.min(count * sum, cap);
        continue;
      }
      if (char === "[") {
        const error = skipClass();
        if (error !== undefined) return error;
      } else if (char === "*") {
        while (chars[pos] === "*") pos++;
      } else {
        pos++;
      }
      tokens = Math.min(tokens + count, tokenCap);
    }
    return { count, tokens };
  };

  const result = sequence(0);
  if (typeof result === "string") return result;
  if (result.count > GLOB_MAX_ALTERNATIVES) return `it expands to more than ${GLOB_MAX_ALTERNATIVES} alternatives`;
  return result.tokens > GLOB_MAX_TOKENS ? `it expands to more than ${GLOB_MAX_TOKENS} tokens` : undefined;
}
