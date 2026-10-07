// Unit arms for the judge's request and its verdict reader, over hand-built
// AgentRuns whose status carries the structured output a judge run writes.
// Domain: conformance benchmark.
//
// Pinned: the judge's instructions carry the rubric and every criterion, and
// the run's structured output schema names exactly the rubric's criteria,
// each a score in 0..1 and a reason; a verdict whose criteria are exactly the
// rubric's is read (each criterion with the rubric's weight, the reasoning
// joined in rubric order, the model the run served) and scored as the
// weighted mean; a missing, extra or malformed criterion, a score outside
// 0..1, or a criterion without a non-empty reason refuses the grade as a
// judge failure with a null score, never a number, and a malformed
// criterion, an out-of-range score or a missing reason is named with its
// value in the refusal; a judge run that failed refuses the grade with the
// platform's error, and one that was cancelled says so; the judge creates one
// agent with the rubric on the native harness, every native built-in in its
// disallowed tools, and one run with the subject, the pinned model, the
// verdict schema and a set session subject, all in the organization the
// request names, defers both deletes, and refuses the grade as a timeout when
// the run never settles.
import { create, type JsonObject } from "@bufbuild/protobuf";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import { FixtureTracker } from "../../harness/fixtures";
import { judge, judgeInstructions, verdictOf, verdictSchema, weightedScore } from "../quality";
import type { QualityCriterion, QualityTask } from "../quality-tasks";

const terminal = vi.hoisted(() => ({ awaitTerminal: vi.fn() }));
vi.mock("../../support/agentruns", async (actual) => ({
  ...(await actual<typeof import("../../support/agentruns")>()),
  awaitTerminal: terminal.awaitTerminal,
}));

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
    const both = { correct_fix: { score: 1, reasoning: "ok" }, meaningful_test: { score: 1, reasoning: "ok" } };
    expect(verdictOf(judged(both), RUBRIC).score, "the well-formed base is read").toBe(1);
    expect(verdictOf(judged({ ...both, style: { score: 1, reasoning: "" } }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, correct_fix: { reasoning: "no score" } }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, correct_fix: 1 }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, meaningful_test: { score: 1.5, reasoning: "" } }), RUBRIC).score).toBeNull();
    expect(verdictOf(judged({ ...both, meaningful_test: { score: -0.1, reasoning: "" } }), RUBRIC).score).toBeNull();
  });

  it("names the criterion whose value is not a score in 0..1, and that value, when the names match", () => {
    const both = { correct_fix: { score: 1, reasoning: "ok" }, meaningful_test: { score: 1, reasoning: "ok" } };
    expect(verdictOf(judged({ ...both, meaningful_test: { score: 1.5, reasoning: "x" } }), RUBRIC).failure).toEqual({
      stage: "judge",
      message: 'the judge\'s criterion "meaningful_test" is {"score":1.5,"reasoning":"x"}, not a score in 0..1 with a reason',
    });
    expect(verdictOf(judged({ ...both, correct_fix: "great" }), RUBRIC).failure?.message).toBe(
      'the judge\'s criterion "correct_fix" is "great", not a score in 0..1 with a reason',
    );
  });

  it("refuses a criterion without a non-empty string reason, naming it and its value, as the schema requires one", () => {
    const both = { correct_fix: { score: 1, reasoning: "ok" }, meaningful_test: { score: 1, reasoning: "ok" } };
    expect(verdictOf(judged({ ...both, meaningful_test: { score: 0.5 } }), RUBRIC)).toEqual({
      score: null,
      criteria: [],
      reasoning: "",
      judge_model: "claude-sonnet-4-6",
      outcome: "failed",
      failure: {
        stage: "judge",
        message: 'the judge\'s criterion "meaningful_test" is {"score":0.5}, not a score in 0..1 with a reason',
      },
    });
    expect(verdictOf(judged({ ...both, correct_fix: { score: 1, reasoning: "" } }), RUBRIC).failure?.message).toBe(
      'the judge\'s criterion "correct_fix" is {"score":1,"reasoning":""}, not a score in 0..1 with a reason',
    );
    expect(verdictOf(judged({ ...both, correct_fix: { score: 1, reasoning: 7 } }), RUBRIC).score).toBeNull();
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

describe("the judge's run", () => {
  const created: { agent?: unknown; run?: unknown } = {};
  const deleted: string[] = [];
  const clients = {
    agentCommand: {
      create: async (agent: unknown) => {
        created.agent = agent;
        return { metadata: { id: "agt_judge", org: "org_bench", slug: "bench-judge" } };
      },
      delete: async ({ value }: { value: string }) => deleted.push(value),
    },
    agentExecutionCommand: {
      create: async (run: unknown) => {
        created.run = run;
        return { metadata: { id: "aex_judge" } };
      },
      delete: async ({ value }: { value: string }) => deleted.push(value),
    },
  } as unknown as ConformanceClients;
  const request = { org: "org_bench", task: TASK, subject: "the diff and its test", judgeModel: "claude-sonnet-4-6", timeoutMs: 1_000 };

  beforeEach(() => {
    created.agent = undefined;
    created.run = undefined;
    deleted.length = 0;
    terminal.awaitTerminal.mockReset();
  });

  it("runs one native agent carrying the rubric and denied every built-in on the subject, with the pinned model and the verdict schema, and cleans both up", async () => {
    const both = { correct_fix: { score: 1, reasoning: "right" }, meaningful_test: { score: 0.5, reasoning: "thin" } };
    terminal.awaitTerminal.mockResolvedValue(judged(both));
    const fixtures = new FixtureTracker();

    const verdict = await judge(clients, fixtures, request);

    expect(created.agent).toMatchObject({
      metadata: { org: "org_bench" },
      spec: { instructions: judgeInstructions(TASK), harness: Harness.NATIVE },
    });
    expect(
      (created.agent as { spec: { disallowedTools?: string[]; tools?: string[] } }).spec,
      "the judge is denied every built-in the native harness binds, by a deny-list",
    ).toMatchObject({ disallowedTools: ["Bash", "Read", "Write", "Edit", "Glob", "Grep", "Agent", "WebFetch", "TodoWrite"] });
    expect((created.agent as { spec: { tools?: string[] } }).spec.tools, "no allow-list").toBeUndefined();
    expect(created.run).toMatchObject({
      metadata: { org: "org_bench" },
      spec: {
        target: {
          case: "sessionSpec",
          value: { agentRef: { org: "org_bench", slug: "bench-judge" }, subject: "benchmark judge" },
        },
        message: "the diff and its test",
        runConfig: { modelName: "claude-sonnet-4-6" },
        structuredOutputSchema: verdictSchema(RUBRIC),
      },
    });
    expect((created.run as { spec: { autoApproveAll?: boolean } }).spec.autoApproveAll, "the judge approves no tool").toBeFalsy();
    expect(terminal.awaitTerminal).toHaveBeenCalledWith(clients, "aex_judge", { timeoutMs: 1_000 });
    expect(verdict).toMatchObject({ judge_run_id: "aex_judge", outcome: "completed", score: weightedScore([
      { name: "correct_fix", score: 1, weight: 3, reasoning: "right" },
      { name: "meaningful_test", score: 0.5, weight: 2, reasoning: "thin" },
    ]) });

    await fixtures.cleanup();
    expect(deleted).toEqual(["aex_judge", "agt_judge"]);
  });

  it("refuses the grade as a timeout, naming the run, when the run never reaches a terminal phase", async () => {
    terminal.awaitTerminal.mockRejectedValue(new Error("timed out after 1000ms"));

    const verdict = await judge(clients, new FixtureTracker(), request);

    expect(verdict).toMatchObject({
      judge_run_id: "aex_judge",
      score: null,
      outcome: "timeout",
      failure: { stage: "judge", message: "the judge run did not reach a terminal phase: timed out after 1000ms" },
    });
  });
});
