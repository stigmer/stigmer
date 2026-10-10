// Conformance suite for AI grading of live runs: an agent's evaluator sends
// its completed runs to the platform's AI judge, which is itself a run.
// Domain: agentic / score — graded on a real engine, with the scripted model
// answering both the graded run and its judge.
//
// The contract under test:
//   - with an evaluator sampling every run, a completed run gets one `judge`
//     score (source score_source_judge) with both standard rubrics, each with
//     its reason, passing when no rubric failed, and naming the model that
//     graded it; the judge's own run and session are gone once the grade is
//     recorded, and the evaluator's month counts the grade;
//   - a judge whose answer is not the verdict's shape leaves the run not
//     graded, "the judge's answer could not be read", never failed;
//   - a monthly limit below one grade's cap leaves the run not graded,
//     "spending limit reached", without starting a judge, and the
//     evaluator's status says why;
//   - a run outside the sample carries no judge score at all;
//   - a run whose agent has no evaluator carries no judge score.
// Scripted turns are consumed in order: the graded run's turn, then the
// judge run's (its session has a subject, so no title call is made), then,
// when the judge's text carries no JSON, the structured-output extractor's.
//
// The two arms whose judge runs gate on CapabilityFlags.runnerActsAsRunCreator.
// A judge run belongs to the organization's grading account, so it needs a
// runner that serves each run with that run's own credential. The
// cloud-execution target's one embedded runner acts as the primary person and
// is refused the judge run, which then fails before it reaches the model. The
// hosted edition gives each judge run a grading sandbox of its own, which the
// composition's sandbox tests prove. The two arms that start no judge run on
// every target.
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, type AnthropicMessageBody } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent } from "../support/agents";
import {
  DID_THE_TASK,
  JUDGE,
  JUDGE_LIMIT_REACHED_REASON,
  JUDGE_UNREADABLE_REASON,
  MADE_NOTHING_UP,
  awaitJudgeVerdict,
  judgeRunsOf,
  makeEvaluator,
} from "../support/evaluators";
import { uniqueName } from "../support/naming";
import { awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { awaitRunHealth } from "../support/scores";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  // A judge whose arm ended before it reached the model would take the next
  // arm's script; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 30_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

const PASSING_VERDICT = JSON.stringify({
  [DID_THE_TASK]: { result: "passed", reason: "The answer gives the summary the request asked for." },
  [MADE_NOTHING_UP]: { result: "not_applicable", reason: "The answer claims no action or data." },
});

interface Graded {
  readonly org: string;
  readonly run: Run;
  readonly evaluatorId: string | undefined;
}

// One run of a fresh agent in a fresh organization, with the evaluator the
// arm asks for (none when `evaluator` is undefined), scripted on the mock.
async function gradedRun(
  evaluator: { sampleRate?: number; monthlyLimitUsd?: number } | undefined,
  script: AnthropicMessageBody[],
): Promise<Graded> {
  const { org } = await target.provisionTenancy();
  await target.fundTenancy?.(org);
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("judged") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  let evaluatorId: string | undefined;
  if (evaluator !== undefined) {
    const created = await clients.evaluatorCommand.create(
      makeEvaluator({ org, agentId: agent.metadata!.id, ...evaluator }),
    );
    evaluatorId = created.metadata!.id;
  }
  for (const turn of script) mock.enqueue(turn);
  const created = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org,
      name: uniqueName("judged-run"),
      agentRef: agentRefOf(agent),
      message: "Summarize the release in one line.",
      autoApproveAll: true,
    }),
  );
  const run = await awaitTerminal(clients, created.metadata!.id);
  expect(
    run.status?.phase,
    `run ${run.metadata?.id} should COMPLETE; reached ${RunPhase[run.status?.phase ?? 0]} (error: ${run.status?.error ?? ""})`,
  ).toBe(RunPhase.RUN_COMPLETED);
  return { org, run, evaluatorId };
}

// Read once at collection time to gate the judge-running arms (constructing a
// target is side-effect-free; setup() is what boots processes).
const runnerServesJudgeRuns = createTarget().capabilities.runnerActsAsRunCreator;

describe("AI grading", () => {
  it.skipIf(!runnerServesJudgeRuns)("[rpc:ScoreQueryController.listByRun] [rpc:EvaluatorQueryController.get] a sampled run gets the judge's verdict on both rubrics, and the judge's run is gone", async () => {
    const { org, run, evaluatorId } = await gradedRun({ sampleRate: 1 }, [
      anthropicText("Release 3.4 ships AI grading."),
      anthropicText(PASSING_VERDICT),
    ]);
    const runId = run.metadata!.id;

    const verdict = await awaitJudgeVerdict(clients, runId);
    expect(verdict.spec?.source).toBe(ScoreSource.judge);
    expect(verdict.spec?.metric).toBe(JUDGE);
    expect(verdict.status?.state).toBe(ScoreState.graded);
    expect(verdict.spec?.value).toEqual({ case: "passed", value: true });
    expect(verdict.spec?.judgeModel, "the judge names the model it ran on").not.toBe("");
    expect(verdict.spec?.criteria.map((c) => [c.name, c.result])).toEqual([
      [DID_THE_TASK, CriterionResult.passed],
      [MADE_NOTHING_UP, CriterionResult.not_applicable],
    ]);
    expect(verdict.spec?.criteria[0]?.reason).toBe("The answer gives the summary the request asked for.");

    // Run health still grades the run on its own.
    expect((await awaitRunHealth(clients, runId)).status?.state).toBe(ScoreState.graded);

    expect(await judgeRunsOf(clients, org, runId), "the judge's run is deleted with its session").toBe(0);
    const evaluator = await clients.evaluatorQuery.get({ value: evaluatorId! });
    expect(evaluator.status?.graded).toBe(1);
    expect(evaluator.status?.reservedUsd, "the grade's cap is given back").toBe(0);
  });

  it.skipIf(!runnerServesJudgeRuns)("[rpc:ScoreQueryController.listByRun] a judge answer that is not the verdict's shape leaves the run not graded", async () => {
    const { run } = await gradedRun({ sampleRate: 1 }, [
      anthropicText("Release 3.4 ships AI grading."),
      anthropicText("I think the agent did fine."),
      // The structured-output extractor's turn, in prose too: no verdict.
      anthropicText("Nothing to extract."),
    ]);
    const verdict = await awaitJudgeVerdict(clients, run.metadata!.id);
    expect(verdict.status?.state).toBe(ScoreState.not_graded);
    expect(verdict.status?.notGradedReason).toBe(JUDGE_UNREADABLE_REASON);
    expect(verdict.spec?.value.case, "a run that could not be graded is never failed").toBeUndefined();
  });

  it("[rpc:ScoreQueryController.listByRun] [rpc:EvaluatorQueryController.get] a limit below one grade's cap refuses the grade without starting a judge", async () => {
    const { org, run, evaluatorId } = await gradedRun({ sampleRate: 1, monthlyLimitUsd: 0.1 }, [
      anthropicText("Release 3.4 ships AI grading."),
    ]);
    const runId = run.metadata!.id;
    const verdict = await awaitJudgeVerdict(clients, runId);
    expect(verdict.status?.state).toBe(ScoreState.not_graded);
    expect(verdict.status?.notGradedReason).toBe(JUDGE_LIMIT_REACHED_REASON);
    expect(await judgeRunsOf(clients, org, runId)).toBe(0);
    const evaluator = await clients.evaluatorQuery.get({ value: evaluatorId! });
    expect(evaluator.status?.notGraded).toBe(1);
    expect(evaluator.status?.lastNotGradedReason).toBe(JUDGE_LIMIT_REACHED_REASON);
    expect(evaluator.status?.spentUsd ?? 0).toBe(0);
  });

  it("[rpc:ScoreQueryController.listByRun] a run outside the sample, or of an agent with no evaluator, carries no judge score", async () => {
    const outside = await gradedRun({ sampleRate: 0.0001 }, [anthropicText("Release 3.4 ships AI grading.")]);
    const ungraded = await gradedRun(undefined, [anthropicText("Release 3.4 ships AI grading.")]);
    for (const { run } of [outside, ungraded]) {
      const runId = run.metadata!.id;
      // Run health is recorded first; the judge's plan runs right after it.
      await awaitRunHealth(clients, runId);
      await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
      const scores = await clients.scoreQuery.listByRun({ runId });
      expect(scores.items.map((score) => score.spec?.metric)).not.toContain(JUDGE);
    }
  });
});
