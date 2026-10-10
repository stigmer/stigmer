/**
 * The `regex` grader: the JavaScript regex `pattern` (with `flags`) is
 * found in the target (`contains`, the default), is absent
 * (`not_contains`), or matches exactly N times (`count:N`), as the
 * format's grader table states. The target is the final message, the
 * trace, the created paths or one file's content (verdict.ts,
 * `focusText`). The pattern runs in the pattern pool under the grader's
 * deadline (patterns.ts).
 *
 * Proven by __tests__/graders.test.ts.
 */
import type { EvalGraderCheck } from "@stigmer/plugin-package";

import type { EvalTrace } from "../../score/eval/trace.js";
import type { PatternRunner } from "./patterns.js";
import { PATTERN_DEADLINE_MS } from "./patterns.js";
import type { GraderVerdict } from "./verdict.js";
import {
  PATTERN_TIME_LIMIT_REASON,
  focusLabel,
  focusText,
  invalidPatternReason,
} from "./verdict.js";

type RegexCheck = Extract<EvalGraderCheck, { type: "regex" }>;

export async function gradeRegex(
  check: RegexCheck,
  trace: EvalTrace,
  patterns: PatternRunner,
): Promise<GraderVerdict> {
  const target = focusText(check.target, trace);
  if (!("text" in target)) {
    return target;
  }
  const limit = check.match.kind === "count" ? check.match.count + 1 : 1;
  const answer = await patterns.count({
    pattern: check.pattern,
    flags: check.flags,
    texts: [target.text],
    limit,
    budgetMs: PATTERN_DEADLINE_MS,
  });
  switch (answer.kind) {
    case "timeout":
      return { notGraded: PATTERN_TIME_LIMIT_REASON };
    case "invalid":
      return { notGraded: invalidPatternReason(answer.message) };
    case "counts":
      break;
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = answer;
      return exhausted;
    }
  }
  const found = answer.counts[0] ?? 0;
  const where = focusLabel(check.target);
  switch (check.match.kind) {
    case "contains":
      return found > 0
        ? { passed: true, reason: `the pattern was found in ${where}` }
        : { passed: false, reason: `the pattern was not found in ${where}` };
    case "not_contains":
      return found === 0
        ? { passed: true, reason: `the pattern is absent from ${where}` }
        : { passed: false, reason: `the pattern was found in ${where}` };
    case "count": {
      const wanted = check.match.count;
      const counted = found > wanted ? `more than ${wanted}` : String(found);
      return found === wanted
        ? {
            passed: true,
            reason: `the pattern matched ${wanted} time(s) in ${where}`,
          }
        : {
            passed: false,
            reason: `the pattern matched ${counted} time(s) in ${where}, expected ${wanted}`,
          };
    }
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = check.match;
      return exhausted;
    }
  }
}
