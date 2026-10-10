/**
 * The code graders of one try, run over its trace: one pure function per
 * grader type (regex.ts, tools.ts, file-exists.ts), patterns in the
 * pattern pool. The two AI-graded types answer "votes": their verdicts
 * come from judge runs the case workflow starts (llm.ts), so this module
 * never calls a model and costs nothing.
 *
 * The `file_exists` graders match on the server's own thread, so their
 * work is bounded per try (file-exists.ts FILE_MATCH_BUDGET): when their
 * cost summed passes the budget, none is matched and each is not graded.
 * Every verdict's reason is cut to the Score criterion's 500 characters
 * here, where it is built, so no reason grows a workflow's history.
 *
 * Proven by __tests__/graders.test.ts.
 */
import type { EvalGrader } from "@stigmer/plugin-package";

import type { EvalTrace } from "../../score/eval/trace.js";
import {
  FILE_MATCH_BUDGET,
  fileMatchCost,
  gradeFileExists,
} from "./file-exists.js";
import type { PatternRunner } from "./patterns.js";
import { gradeRegex } from "./regex.js";
import { gradeToolOrder, gradeToolUsed } from "./tools.js";
import type { GraderVerdict } from "./verdict.js";
import { TOO_MANY_CREATED_FILES_REASON, cutReason } from "./verdict.js";

/** A code grader's verdict, or "votes" for a grader the judge decides. */
export type CheckOutcome = GraderVerdict | "votes";

export async function gradeCheck(
  grader: EvalGrader,
  trace: EvalTrace,
  patterns: PatternRunner,
): Promise<CheckOutcome> {
  const check = grader.check;
  switch (check.type) {
    case "regex":
      return gradeRegex(check, trace, patterns);
    case "tool_used":
      return gradeToolUsed(check, trace, patterns);
    case "tool_order":
      return gradeToolOrder(check, trace, patterns);
    case "file_exists":
      return gradeFileExists(check, trace);
    case "llm":
    case "baseline":
      return "votes";
    /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
    default: {
      const exhausted: never = check;
      return exhausted;
    }
  }
}

/**
 * Every grader of a case, in order (the module header). `fileMatchBudget`
 * is FILE_MATCH_BUDGET unless a test passes a smaller one.
 */
export async function gradeChecks(
  graders: ReadonlyArray<EvalGrader>,
  trace: EvalTrace,
  patterns: PatternRunner,
  fileMatchBudget: number = FILE_MATCH_BUDGET,
): Promise<CheckOutcome[]> {
  let fileMatchWork = 0;
  for (const grader of graders) {
    if (grader.check.type === "file_exists") {
      fileMatchWork += fileMatchCost(grader.check, trace);
    }
  }
  const overBudget = fileMatchWork > fileMatchBudget;
  return Promise.all(
    graders.map(async (grader): Promise<CheckOutcome> => {
      if (overBudget && grader.check.type === "file_exists") {
        return { notGraded: TOO_MANY_CREATED_FILES_REASON };
      }
      const outcome = await gradeCheck(grader, trace, patterns);
      return outcome === "votes" ? outcome : cutVerdict(outcome);
    }),
  );
}

/** `verdict` with its reason cut to the criterion's limit. */
function cutVerdict(verdict: GraderVerdict): GraderVerdict {
  return "notGraded" in verdict
    ? { notGraded: cutReason(verdict.notGraded) }
    : { passed: verdict.passed, reason: cutReason(verdict.reason) };
}
