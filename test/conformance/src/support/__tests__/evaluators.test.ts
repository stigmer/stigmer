// Pins the AI-grading suites' fixtures, copy and reads
// (support/evaluators.ts): a fresh evaluator is enabled, samples every run and spends ten dollars a
// month unless told otherwise; the verdict read polls a run's scores past
// the judge's pending score until a grade or a not-graded reason lands,
// failing loudly once its budget is spent; the judge-run count reads the
// organization's runs by the judge label. The clients are stubbed; nothing
// here starts a server.
import { create } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreState } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import {
  GRADES_RUN_LABEL,
  JUDGE,
  awaitJudgeVerdict,
  evaluatorOrgMismatchMessage,
  judgeRunsOf,
  makeEvaluator,
} from "../evaluators";

function judgeScore(state: ScoreState): Score {
  return create(ScoreSchema, { spec: { runId: "run_1", metric: JUDGE }, status: { state } });
}

function listing(pages: Score[][]): ConformanceClients {
  let calls = 0;
  return {
    scoreQuery: {
      listByRun: async () => {
        const items = pages[Math.min(calls, pages.length - 1)] ?? [];
        calls += 1;
        return { items };
      },
    },
  } as unknown as ConformanceClients;
}

describe("evaluator fixtures", () => {
  it("a fresh evaluator is enabled, samples every run and spends ten dollars a month", () => {
    expect(makeEvaluator({ org: "org_1", agentId: "agt_1" })).toMatchObject({
      metadata: { org: "org_1" },
      spec: { agentId: "agt_1", enabled: true, sampleRate: 1, monthlyLimitUsd: 10, modelName: "" },
    });
    expect(makeEvaluator({ org: "org_1", agentId: "agt_1", sampleRate: 0.5, monthlyLimitUsd: 2 }).spec).toMatchObject({
      sampleRate: 0.5,
      monthlyLimitUsd: 2,
    });
  });
});

describe("evaluator copy", () => {
  it("names the agent's organization in the mismatch refusal, as the server does", () => {
    expect(evaluatorOrgMismatchMessage("org_1")).toBe("metadata.org must be the agent's organization (org_1)");
  });
});

describe("awaitJudgeVerdict", () => {
  it("reads past the pending score to the verdict", async () => {
    const verdict = await awaitJudgeVerdict(
      listing([[], [judgeScore(ScoreState.pending)], [judgeScore(ScoreState.graded)]]),
      "run_1",
      5_000,
    );
    expect(verdict.status?.state).toBe(ScoreState.graded);
  });

  it("fails loudly once its budget is spent", async () => {
    await expect(awaitJudgeVerdict(listing([[judgeScore(ScoreState.pending)]]), "run_1", 0)).rejects.toThrow(
      "run run_1 carries no judge verdict after 0 ms",
    );
  });
});

describe("judgeRunsOf", () => {
  it("counts the organization's runs that grade the run", async () => {
    const run = (labels: Record<string, string>) => create(RunSchema, { metadata: { labels } });
    const clients = {
      agentExecutionQuery: {
        list: async () => ({
          entries: [run({ [GRADES_RUN_LABEL]: "run_1" }), run({ [GRADES_RUN_LABEL]: "run_2" }), run({})],
        }),
      },
    } as unknown as ConformanceClients;
    expect(await judgeRunsOf(clients, "org_1", "run_1")).toBe(1);
  });
});
