/**
 * Pins the eval's Score (score-writer.ts): source eval with metric "eval"
 * on the try's run and organization; the evaluator version pinned to the
 * archive digest and the judge instruction's version; passed when every
 * scored grader passed; one criterion per grader, named within the
 * 63-character limit and unique, reasons within 500; an indicator
 * `not_applicable` with "indicator only" and what it found, or why it
 * was not graded, the try still passing on its scored graders; a not-graded
 * score with its reason and no value.
 */
import { create } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import type { EvalGrader, EvalGraderCheck } from "@stigmer/plugin-package";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";

import { EVAL_METRIC } from "../../score/constants.js";
import { JUDGE_INSTRUCTION_VERSION } from "../../score/judge/rubrics.js";
import {
  INDICATOR_ONLY_REASON,
  criterionNames,
  evalEvaluatorVersion,
  gradedEvalScore,
  notGradedEvalScore,
} from "../score-writer.js";
import { scoringOf } from "../scoring.js";

const DIGEST = "a".repeat(64);
const run = create(RunSchema, { metadata: { id: "run_try", org: "acme" } });

const regex: EvalGraderCheck = {
  type: "regex",
  pattern: "x",
  flags: "",
  match: { kind: "contains" },
  target: { kind: "last_message" },
};
const skill: EvalGraderCheck = { type: "tool_used", tool: "Skill", min: 1 };

function grader(name: string, check: EvalGraderCheck): EvalGrader {
  return { name, path: "p", weight: 1, check };
}

describe("the eval score", () => {
  it("pins its version to the archive digest and the judge instruction", () => {
    const expected = createHash("sha256")
      .update(
        JSON.stringify({
          suite: DIGEST,
          instruction: JUDGE_INSTRUCTION_VERSION,
        }),
      )
      .digest("hex");
    expect(evalEvaluatorVersion(DIGEST)).toBe(expected);
    expect(evalEvaluatorVersion("b".repeat(64))).not.toBe(expected);
  });

  it("writes one criterion per grader, indicators not applicable", () => {
    const graders = [
      grader("mentions-rename", regex),
      grader("skill-fired", skill),
    ];
    const score = gradedEvalScore(run, DIGEST, {
      graders,
      scoring: scoringOf(graders, true),
      verdicts: [
        { passed: true, reason: "the pattern was found" },
        { passed: false, reason: "0 call(s) to 'Skill'" },
      ],
    });
    expect(score.metadata?.org).toBe("acme");
    expect(score.spec?.runId).toBe("run_try");
    expect(score.spec?.metric).toBe(EVAL_METRIC);
    expect(score.spec?.source).toBe(ScoreSource.eval);
    expect(score.spec?.value).toEqual({ case: "passed", value: true });
    expect(score.spec?.criteria.map((c) => [c.name, c.result])).toEqual([
      ["mentions-rename", CriterionResult.passed],
      ["skill-fired", CriterionResult.not_applicable],
    ]);
    expect(score.spec?.criteria[1]?.reason).toBe(
      `${INDICATOR_ONLY_REASON}; failed: 0 call(s) to 'Skill'`,
    );
  });

  it("reports an indicator left not graded on its criterion, and still passes on the scored graders", () => {
    const graders = [
      grader("mentions-rename", regex),
      grader("skill-fired", skill),
    ];
    const score = gradedEvalScore(run, DIGEST, {
      graders,
      scoring: scoringOf(graders, true),
      verdicts: [
        { passed: true, reason: "the pattern was found" },
        { notGraded: "the judge could not start" },
      ],
    });
    expect(score.spec?.value).toEqual({ case: "passed", value: true });
    expect(score.spec?.criteria[1]).toMatchObject({
      result: CriterionResult.not_applicable,
      reason: `${INDICATOR_ONLY_REASON}; not graded: the judge could not start`,
    });
  });

  it("fails when a scored grader failed, and bounds every reason", () => {
    const graders = [grader("a", regex)];
    const score = gradedEvalScore(run, DIGEST, {
      graders,
      scoring: scoringOf(graders, true),
      verdicts: [{ passed: false, reason: "r".repeat(900) }],
    });
    expect(score.spec?.value).toEqual({ case: "passed", value: false });
    expect(score.spec?.criteria[0]?.result).toBe(CriterionResult.failed);
    expect(score.spec?.criteria[0]?.reason.length).toBeLessThanOrEqual(500);
  });

  it("names criteria within the limit and uniquely", () => {
    const long = "x".repeat(70);
    const names = criterionNames([
      grader(long, regex),
      grader(long, regex),
      grader("", regex),
    ]);
    expect(names[0]).toHaveLength(63);
    expect(names[1]).toHaveLength(63);
    expect(names[1]?.endsWith("-2")).toBe(true);
    expect(names[2]).toBe("grader-3");
    expect(new Set(names).size).toBe(3);
  });

  it("records a try the platform could not grade as not graded, with its reason", () => {
    const score = notGradedEvalScore(run, DIGEST, "platform busy");
    expect(score.spec?.value.case).toBeUndefined();
    expect(score.status?.notGradedReason).toBe("platform busy");
    expect(score.spec?.evaluatorVersion).toBe(evalEvaluatorVersion(DIGEST));
  });
});
