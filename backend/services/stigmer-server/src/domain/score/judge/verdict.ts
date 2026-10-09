/**
 * The strict reader of a judge run's verdict: its structured output must
 * name exactly the rubrics (rubrics.ts), each with a result of passed,
 * failed or not_applicable and a reason of 1 to 500 characters, and
 * nothing else. Anything else is refused, never read as a lower grade: a
 * model's structured reply can still miss its schema (the runner's
 * extraction tiers fall back to the reply's text), and a skipped rubric
 * read as a failure would change what a grade means. The grading activity
 * records a refusal as not graded, "the judge's answer could not be read".
 *
 * Proven by __tests__/judge.test.ts.
 */
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";

import { CriterionResult } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";

import { REASON_MAX_LENGTH, RUBRICS } from "./rubrics.js";

/** One rubric's verdict. */
export interface RubricVerdict {
  readonly name: string;
  readonly result: CriterionResult;
  readonly reason: string;
}

/** The judge's verdict, in rubric order, or the refusal's cause for the log. */
export type VerdictReading =
  | { readonly kind: "read"; readonly verdicts: ReadonlyArray<RubricVerdict> }
  | { readonly kind: "refused"; readonly cause: string };

const RESULTS: Readonly<Record<string, CriterionResult>> = {
  passed: CriterionResult.passed,
  failed: CriterionResult.failed,
  not_applicable: CriterionResult.not_applicable,
};

export function readVerdict(output: JsonObject | undefined): VerdictReading {
  if (output === undefined) {
    return { kind: "refused", cause: "the judge run delivered no structured output" };
  }
  const wanted = RUBRICS.map((rubric) => rubric.name);
  const got = Object.keys(output);
  if (got.length !== wanted.length || !wanted.every((name) => got.includes(name))) {
    return {
      kind: "refused",
      cause: `the judge returned ${JSON.stringify(got)} for the rubrics ${JSON.stringify(wanted)}`,
    };
  }
  const verdicts: RubricVerdict[] = [];
  for (const name of wanted) {
    const verdict = rubricVerdictOf(name, output[name]);
    if (verdict === undefined) {
      return {
        kind: "refused",
        cause: `the judge's ${JSON.stringify(name)} is not a result with a reason of 1 to ${REASON_MAX_LENGTH} characters`,
      };
    }
    verdicts.push(verdict);
  }
  return { kind: "read", verdicts };
}

function rubricVerdictOf(
  name: string,
  value: JsonValue | undefined,
): RubricVerdict | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("result") || !keys.includes("reason")) {
    return undefined;
  }
  const { result, reason } = value;
  if (typeof result !== "string" || !Object.hasOwn(RESULTS, result)) {
    return undefined;
  }
  if (
    typeof reason !== "string" ||
    reason.trim() === "" ||
    reason.length > REASON_MAX_LENGTH
  ) {
    return undefined;
  }
  const criterion = RESULTS[result];
  return criterion === undefined ? undefined : { name, result: criterion, reason };
}
