/**
 * A hook group's matcher, Claude Code's rule, tested against the tool name a
 * hook sees (`tool-view.ts`):
 *
 *  - empty or `*` matches every tool;
 *  - a matcher made only of letters, digits, `_`, `-`, spaces, `,` and `|`
 *    is an exact list of names (`Write|Edit`, `Bash, Read`);
 *  - anything else is a JavaScript regular expression, unanchored
 *    (`mcp__github__.*`, `Notebook.*`).
 *
 * Install and apply refuse a matcher that is none of these, so the one left
 * here that does not compile matches nothing, with a log line.
 */

const EXACT_LIST = /^[A-Za-z0-9_\- ,|]+$/;

export function matcherMatches(matcher: string, toolName: string): boolean {
  if (matcher === "" || matcher === "*") return true;
  if (EXACT_LIST.test(matcher)) {
    return matcher
      .split(/[|,]/)
      .map((name) => name.trim())
      .some((name) => name === toolName);
  }
  try {
    return new RegExp(matcher).test(toolName);
  } catch {
    console.warn(`[hooks] a matcher that is not a regular expression matches nothing: ${matcher}`);
    return false;
  }
}
