// Unit arms for the verdict reader, over hand-built WorkflowExecutions whose
// judge task output carries the shape the runner's eval writes in
// EVAL_MULTI_CRITERIA mode (runner activities/call-eval.ts).
// Domain: conformance benchmark.
//
// Pinned: a verdict whose criteria are exactly the rubric's is read (the
// score, each criterion with the rubric's weight, the reasoning, the judge
// model the eval reports); a missing, extra, duplicated or malformed
// criterion refuses the grade as a judge failure with a null score, never a
// number; a judge workflow that failed refuses the grade with the platform's
// error.
import { create, type JsonObject } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { EVAL_TASK_NAME } from "../../support/workflows";
import { verdictOf } from "../quality";
import type { QualityCriterion } from "../quality-tasks";

const RUBRIC: QualityCriterion[] = [
  { name: "correct_fix", description: "d", weight: 3 },
  { name: "meaningful_test", description: "d", weight: 2 },
];

function judged(output: JsonObject, phase = ExecutionPhase.EXECUTION_COMPLETED, error = "") {
  return create(WorkflowExecutionSchema, {
    status: { phase, error, tasks: [{ taskName: EVAL_TASK_NAME, output }] },
  });
}

describe("verdictOf", () => {
  it("reads a verdict whose criteria are exactly the rubric's, with the rubric's weights", () => {
    const verdict = verdictOf(
      judged({
        pass: true,
        score: 0.84,
        reasoning: "correct_fix: right; meaningful_test: thin",
        criteria: [
          { name: "meaningful_test", score: 0.6, reasoning: "thin" },
          { name: "correct_fix", score: 1, reasoning: "right" },
        ],
        model_used: "claude-sonnet-4-6",
      }),
      RUBRIC,
    );
    expect(verdict).toEqual({
      score: 0.84,
      criteria: [
        { name: "correct_fix", weight: 3, score: 1, reasoning: "right" },
        { name: "meaningful_test", weight: 2, score: 0.6, reasoning: "thin" },
      ],
      reasoning: "correct_fix: right; meaningful_test: thin",
      judge_model: "claude-sonnet-4-6",
      outcome: "completed",
    });
  });

  it("refuses a verdict that skipped a criterion, the case the eval would silently rescale", () => {
    const verdict = verdictOf(
      judged({ score: 1, criteria: [{ name: "correct_fix", score: 1, reasoning: "" }], model_used: "m" }),
      RUBRIC,
    );
    expect(verdict.score).toBeNull();
    expect(verdict.outcome).toBe("failed");
    expect(verdict.failure?.stage).toBe("judge");
    expect(verdict.failure?.message).toContain("meaningful_test");
    expect(verdict.judge_model).toBe("m");
  });

  it("refuses an unparseable reply (no criteria, score 0) and an extra or duplicated criterion", () => {
    expect(verdictOf(judged({ score: 0, criteria: [], model_used: "m" }), RUBRIC).failure?.stage).toBe("judge");
    const extra = [
      { name: "correct_fix", score: 1, reasoning: "" },
      { name: "meaningful_test", score: 1, reasoning: "" },
      { name: "style", score: 1, reasoning: "" },
    ];
    expect(verdictOf(judged({ score: 1, criteria: extra }), RUBRIC).score).toBeNull();
    const duplicated = [
      { name: "correct_fix", score: 1, reasoning: "" },
      { name: "correct_fix", score: 0, reasoning: "" },
    ];
    expect(verdictOf(judged({ score: 0.5, criteria: duplicated }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ score: 1, criteria: [{ name: "correct_fix" }, { name: "meaningful_test", score: 1 }] }), RUBRIC).score).toBeNull();
  });

  it("a judge workflow that failed refuses the grade with the platform's error", () => {
    const verdict = verdictOf(judged({}, ExecutionPhase.EXECUTION_FAILED, "judge model not in registry"), RUBRIC);
    expect(verdict).toEqual({
      score: null,
      criteria: [],
      reasoning: "",
      judge_model: "",
      outcome: "failed",
      failure: { stage: "judge", message: "judge model not in registry" },
    });
  });
});
