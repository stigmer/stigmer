/**
 * Detects a class token whose `stg:` prefix sits after a variant instead of
 * before it, and says where the prefix belongs (stigmer/stigmer#1227).
 *
 * Tailwind's `prefix(stg)` only matches a candidate that STARTS with the
 * prefix: `stg:sm:grid-cols-2` compiles, `sm:stg:grid-cols-2` compiles to
 * nothing. The reversed form fails silently, because it is neither a
 * utility nor an unprefixed utility the migration guard would flag, so
 * `scripts/prefix-classnames.ts` asks this module first, in both its rewrite
 * and `--check` modes.
 *
 * Variant boundaries are the colons outside `[...]` and `(...)`: a bracketed
 * variant (`data-[state=open]:`), Tailwind v4's parenthesised forms
 * (`supports-(display:grid):`, `bg-(--x)`) and arbitrary values
 * (`[mask-type:luminance]`) carry colons that are not boundaries.
 */

/** Split a class token into its variant chain and utility, at top-level colons. */
function splitAtVariantBoundaries(token: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[" || ch === "(") {
      depth++;
    } else if ((ch === "]" || ch === ")") && depth > 0) {
      depth--;
    } else if (ch === ":" && depth === 0) {
      segments.push(token.slice(start, i));
      start = i + 1;
    }
  }
  segments.push(token.slice(start));
  return segments;
}

/**
 * The token with its prefix moved to the front, when a variant precedes it
 * (`sm:stg:grid-cols-2` → `stg:sm:grid-cols-2`); `undefined` for a token
 * that is already correct or carries no misplaced prefix.
 *
 * @param token One whitespace-delimited class token.
 * @param prefix The variant-form prefix, with or without its colon (`stg:`).
 */
export function relocatePrefix(token: string, prefix: string): string | undefined {
  const name = prefix.endsWith(":") ? prefix.slice(0, -1) : prefix;
  const segments = splitAtVariantBoundaries(token);
  if (segments[0] === name) return undefined;
  // The prefix is a variant, so it is never the last segment (the utility).
  const at = segments.indexOf(name, 1);
  if (at === -1 || at === segments.length - 1) return undefined;
  return [name, ...segments.slice(0, at), ...segments.slice(at + 1)].join(":");
}
