/**
 * A hook group's matcher, compiled once per turn (`hook-set.ts`) and tested
 * against each call's targets (`formats/*.ts`), by its format's rule:
 *
 *  - Claude Code's: empty or `*` matches every tool; a matcher made only of
 *    letters, digits, `_`, `-`, spaces, `,` and `|` is an exact list of
 *    names (`Write|Edit`, `Bash, Read`); anything else is a JavaScript
 *    regular expression, unanchored (`mcp__github__.*`, `Notebook.*`).
 *  - Cursor's: empty or `*` matches every call; anything else is an
 *    unanchored regular expression, never an exact list.
 *
 * Install and apply refuse a matcher that does not compile, so one left
 * here (stored before that check) matches nothing, logged once when it is
 * compiled.
 *
 * A regular expression is the plugin author's, and the target can be the
 * model's (a shell command's whole text), so a pattern that backtracks
 * exponentially could hold the runner's one thread for minutes, its stall
 * watchdog included. Each test therefore runs through `node:vm` with a
 * timeout of {@link MATCHER_BUDGET_MS}: V8 checks for the interrupt while
 * it backtracks, lookaheads and backreferences included, which a linear
 * engine (RE2, V8's experimental fallback) would refuse or leave unbounded.
 * A test stopped there is `timed-out`, and the evaluator fails that group's
 * hooks under its format's own failure rule (`evaluate.ts`). Real matchers
 * finish in microseconds; the vm costs about 40 µs a test for the watchdog
 * thread it starts, which is why `*` and exact lists never enter it. A
 * pattern compiled without flags keeps no state between tests.
 */

import { createContext, Script, type Context } from "node:vm";
import type { HookFormatName } from "./hook-set.js";

/** The longest one test of a regular-expression matcher may run, in milliseconds. */
export const MATCHER_BUDGET_MS = 100;

/** What one test of a matcher found; `timed-out` when it was stopped at the budget. */
export type MatcherVerdict = "match" | "miss" | "timed-out";

/** A compiled matcher. */
export interface Matcher {
  test(target: string): MatcherVerdict;
}

const EXACT_LIST = /^[A-Za-z0-9_\- ,|]+$/;
const EVERY: Matcher = { test: () => "match" };
const NONE: Matcher = { test: () => "miss" };

/** Compile a group's matcher by its format's rule. */
export function compileMatcher(text: string, format: HookFormatName): Matcher {
  if (text === "" || text === "*") return EVERY;
  if (format === "claude-code" && EXACT_LIST.test(text)) {
    const names = new Set(text.split(/[|,]/).map((name) => name.trim()));
    return { test: (target) => (names.has(target) ? "match" : "miss") };
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(text);
  } catch {
    console.warn(`[hooks] a matcher that is not a regular expression matches nothing: ${text}`);
    return NONE;
  }
  return { test: (target) => timedTest(pattern, target) };
}

/** The one context and script every timed test runs in, made on the first. */
interface Sandbox {
  readonly context: Context & { pattern?: RegExp; target?: string };
  readonly script: Script;
}
let sandbox: Sandbox | undefined;

function timedTest(pattern: RegExp, target: string): MatcherVerdict {
  sandbox ??= { context: createContext({}), script: new Script("pattern.test(target)") };
  sandbox.context.pattern = pattern;
  sandbox.context.target = target;
  try {
    return sandbox.script.runInContext(sandbox.context, { timeout: MATCHER_BUDGET_MS }) === true ? "match" : "miss";
  } catch (err) {
    if (!isScriptTimeout(err)) throw err;
    return "timed-out";
  }
}

/** Node's timeout error comes from the context's realm, so it is read by its code, not by `instanceof`. */
function isScriptTimeout(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ERR_SCRIPT_EXECUTION_TIMEOUT";
}
