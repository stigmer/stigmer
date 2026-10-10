/**
 * The code graders of one try, run over its trace: one pure function per
 * grader type (regex.ts, tools.ts, file-exists.ts), patterns in the
 * pattern pool. The two AI-graded types answer "votes": their verdicts
 * come from judge runs the case workflow starts (llm.ts), so this module
 * never calls a model and costs nothing.
 *
 * Proven by __tests__/graders.test.ts.
 */
import type { EvalGrader } from "@stigmer/plugin-package";

import type { EvalTrace } from "../../score/eval/trace.js";
import { gradeFileExists } from "./file-exists.js";
import type { PatternRunner } from "./patterns.js";
import { gradeRegex } from "./regex.js";
import { gradeToolOrder, gradeToolUsed } from "./tools.js";
import type { GraderVerdict } from "./verdict.js";

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
    default: {
      const exhausted: never = check;
      return exhausted;
    }
  }
}

/** Every grader of a case, in order. */
export function gradeChecks(
  graders: ReadonlyArray<EvalGrader>,
  trace: EvalTrace,
  patterns: PatternRunner,
): Promise<CheckOutcome[]> {
  return Promise.all(
    graders.map((grader) => gradeCheck(grader, trace, patterns)),
  );
}
