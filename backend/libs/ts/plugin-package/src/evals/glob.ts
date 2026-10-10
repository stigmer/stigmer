/**
 * Whether a glob is well formed, in the grammar Stigmer's eval graders
 * match with: `*`, `**`, `?`, `[...]` classes with ranges and `!` or `^`
 * negation (a `]` right after the opening or the negation is a member),
 * and `{a,b}` alternatives that may nest, expanding to at most
 * GLOB_MAX_ALTERNATIVES and nesting at most GLOB_MAX_BRACE_DEPTH deep;
 * everything else is literal, a `}` with no `{` included.
 *
 * Only validity is checked here: the suite reader refuses a `file_exists`
 * grader whose `path` is malformed (a class or a brace never closed, a
 * reversed range, too many alternatives, braces nested too deep), so the
 * author hears it at push rather than as a try left not graded. The server
 * compiles and matches globs with its own matcher over the same grammar,
 * and its tests pin the two readers to one table, error sentences
 * included.
 */

/** The most alternatives a glob's braces may expand to. */
export const GLOB_MAX_ALTERNATIVES = 64;

/** The deepest braces may nest. */
export const GLOB_MAX_BRACE_DEPTH = 16;

/** Why `glob` is malformed, or `undefined` when it is a glob. */
export function globError(glob: string): string | undefined {
  const chars = Array.from(glob);
  let pos = 0;
  const cap = GLOB_MAX_ALTERNATIVES + 1;

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

  /** The alternatives of a sequence (capped), up to the end or, inside braces, its `,` or `}`. */
  const sequence = (depth: number): number | string => {
    let count = 1;
    while (pos < chars.length) {
      const char = chars[pos];
      if (depth > 0 && (char === "," || char === "}")) return count;
      if (char === "[") {
        const error = skipClass();
        if (error !== undefined) return error;
      } else if (char === "{") {
        const open = pos;
        if (depth + 1 > GLOB_MAX_BRACE_DEPTH) return `braces are nested more than ${GLOB_MAX_BRACE_DEPTH} deep`;
        pos++;
        let sum = 0;
        for (;;) {
          const inner = sequence(depth + 1);
          if (typeof inner === "string") return inner;
          sum = Math.min(sum + inner, cap);
          const close = chars[pos];
          if (close === undefined) return `'{' at ${open} is never closed`;
          pos++;
          if (close === "}") break;
        }
        count = Math.min(count * sum, cap);
      } else {
        pos++;
      }
    }
    return count;
  };

  const result = sequence(0);
  if (typeof result === "string") return result;
  return result > GLOB_MAX_ALTERNATIVES ? `it expands to more than ${GLOB_MAX_ALTERNATIVES} alternatives` : undefined;
}
