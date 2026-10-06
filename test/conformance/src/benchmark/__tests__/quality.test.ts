// Unit arms for the judge's request and its verdict reader, over hand-built
// AgentRuns whose status carries the structured output a judge run writes.
// Domain: conformance benchmark.
//
// Pinned: the judge's instructions carry the rubric and every criterion, and
// the run's structured output schema names exactly the rubric's criteria,
// each a score in 0..1 and a reason; a verdict whose criteria are exactly the
// rubric's is read (each criterion with the rubric's weight, the reasoning
// joined in rubric order, the model the run served) and scored as the
// weighted mean; a missing, extra or malformed criterion, or a score outside
// 0..1, refuses the grade as a judge failure with a null score, never a
// number; a judge run that failed refuses the grade with the platform's
// error, and one that was cancelled says so.
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { judgeInstructions, verdictOf, verdictSchema, weightedScore } from "../quality";
import type { QualityCriterion, QualityTask } from "../quality-tasks";

const RUBRIC: QualityCriterion[] = [
  { name: "correct_fix", description: "The fix is right.", weight: 3 },
  { name: "meaningful_test", description: "The test pins the fix.", weight: 2 },
];

const TASK: QualityTask = {
  id: "fix",
  placeholder: false,
  turns: ["Fix it."],
  files: [],
  checks: [],
  rubric: "Grade the fix and its test.",
  criteria: RUBRIC,
};

function judged(output: JsonObject | undefined, phase = RunPhase.RUN_COMPLETED, error = "", model = "claude-sonnet-4-6") {
  return create(AgentRunSchema, {
    status: {
      phase,
      error,
      ...(output !== undefined ? { structuredOutput: output } : {}),
      streamingUsage: { model },
    },
  });
}

describe("the judge's request", () => {
  it("instructs the judge with the rubric and every criterion by name and description", () => {
    const instructions = judgeInstructions(TASK);
    expect(instructions).toContain("Grade the fix and its test.");
    expect(instructions).toContain("- correct_fix: The fix is right.");
    expect(instructions).toContain("- meaningful_test: The test pins the fix.");
  });

  it("asks for a structured output naming exactly the rubric's criteria, each a 0..1 score and a reason", () => {
    const criterion = {
      type: "object",
      properties: { score: { type: "number", minimum: 0, maximum: 1 }, reasoning: { type: "string" } },
      required: ["score", "reasoning"],
      additionalProperties: false,
    };
    expect(verdictSchema(RUBRIC)).toEqual({
      type: "object",
      properties: {
        correct_fix: { ...criterion, description: "The fix is right." },
        meaningful_test: { ...criterion, description: "The test pins the fix." },
      },
      required: ["correct_fix", "meaningful_test"],
      additionalProperties: false,
    });
  });
});

describe("verdictOf", () => {
  it("reads a verdict whose criteria are exactly the rubric's, with the rubric's weights, scored as their weighted mean", () => {
    const verdict = verdictOf(
      judged({
        meaningful_test: { score: 0.6, reasoning: "thin" },
        correct_fix: { score: 1, reasoning: "right" },
      }),
      RUBRIC,
    );
    expect(verdict).toEqual({
      score: (1 * 3 + 0.6 * 2) / 5,
      criteria: [
        { name: "correct_fix", weight: 3, score: 1, reasoning: "right" },
        { name: "meaningful_test", weight: 2, score: 0.6, reasoning: "thin" },
      ],
      reasoning: "correct_fix: right; meaningful_test: thin",
      judge_model: "claude-sonnet-4-6",
      outcome: "completed",
    });
  });

  it("weights each criterion by its rubric weight", () => {
    expect(
      weightedScore([
        { name: "a", weight: 3, score: 1, reasoning: "" },
        { name: "b", weight: 1, score: 0.5, reasoning: "" },
      ]),
    ).toBeCloseTo(0.875, 10);
  });

  it("refuses a verdict that skipped a criterion, never rescaling over the ones returned", () => {
    const verdict = verdictOf(judged({ correct_fix: { score: 1, reasoning: "" } }, RunPhase.RUN_COMPLETED, "", "m"), RUBRIC);
    expect(verdict.score).toBeNull();
    expect(verdict.outcome).toBe("failed");
    expect(verdict.failure?.stage).toBe("judge");
    expect(verdict.failure?.message).toContain("meaningful_test");
    expect(verdict.judge_model).toBe("m");
  });

  it("refuses a run with no structured output, an extra criterion, a malformed one and a score outside 0..1", () => {
    expect(verdictOf(judged(undefined), RUBRIC).failure?.stage).toBe("judge");
    const both = { correct_fix: { score: 1, reasoning: "" }, meaningful_test: { score: 1, reasoning: "" } };
    expect(verdictOf(judged({ ...both, style: { score: 1, reasoning: "" } }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, correct_fix: { reasoning: "no score" } }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, correct_fix: 1 }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, meaningful_test: { score: 1.5, reasoning: "" } }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, meaningful_test: { score: -0.1, reasoning: "" } }), RUBRIC).score).toBeNull();
  });

  it("a judge run that failed refuses the grade with the platform's error", () => {
    const verdict = verdictOf(judged(undefined, RunPhase.RUN_FAILED, "judge model not in registry"), RUBRIC);
    expect(verdict).toEqual({
      score: null,
      criteria: [],
      reasoning: "",
      judge_model: "",
      outcome: "failed",
      failure: { stage: "judge", message: "judge model not in registry" },
    });
  });

  it("a judge run that was cancelled refuses the grade naming how it ended", () => {
    const verdict = verdictOf(judged(undefined, RunPhase.RUN_CANCELLED), RUBRIC);
    expect(verdict.outcome).toBe("cancelled");
    expect(verdict.failure).toEqual({ stage: "judge", message: "the judge run ended cancelled" });
  });
});
