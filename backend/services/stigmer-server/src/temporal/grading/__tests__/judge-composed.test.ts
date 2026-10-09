/**
 * Pins the AI judge's server half through the REAL stack on a trusted-local
 * server: the score lanes for a judge, the one write rule for the server's
 * scores, the evaluator lanes, and the judge's activities over a real store
 * with the judge run's create and its session's delete played by doubles
 * that write the rows an engine would (no engine runs here).
 *
 * The load-bearing pins:
 *   - a judge score comes from the server alone: refused on the wire,
 *     admitted in process, pending when the server asks, carrying its
 *     model; a judge model on any other source is refused; one judge
 *     score per run per rubric version;
 *   - replaceUnlessGraded: the stigmer#2057 interleave keeps the grade (a
 *     not-graded placeholder written between the grade's read and its
 *     create is replaced), a placeholder never replaces a grade, and a
 *     judge's pending score gives way to its grade;
 *   - evaluators: create, the one-per-agent rule, getByAgent, an update
 *     that keeps the month's spend written meanwhile, and the agent's
 *     delete removing its evaluator;
 *   - the activities: a sampled run is recorded pending and a cap set
 *     aside; the start creates one judge run, found again on a retry; a
 *     verdict replaces the pending score, the session is deleted and the
 *     budget settled with the judge's spend; an unreadable answer, a cost
 *     cap and a refused start each leave the run not graded with its
 *     reason and settle; a limit refusal records the reason without a
 *     judge; a judge run, a run of no agent and a run outside the sample
 *     are skipped.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { EvaluatorCommandController } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/command_pb";
import { EvaluatorQueryController } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/query_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreCommandController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/command_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreQueryController } from "@stigmer/protos/ai/stigmer/agentic/score/v1/query_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ErrorInfoSchema } from "@stigmer/protos/google/rpc/error_details_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { reserve } from "../../../domain/evaluator/budget.js";
import { EVALUATOR_EXISTS_REASON } from "../../../domain/evaluator/constants.js";
import {
  JUDGE_COST_CAP_REASON,
  JUDGE_LIMIT_REACHED_REASON,
  JUDGE_NOT_STARTED_REASON,
  JUDGE_OUT_OF_CREDIT_REASON,
  JUDGE_RUN_FAILED_REASON,
  JUDGE_SOURCE_REFUSED_MESSAGE,
  JUDGE_UNREADABLE_REASON,
  SCORE_JUDGE_MODEL_JUDGE_ONLY_MESSAGE,
  judgeExistsMessage,
} from "../../../domain/score/constants.js";
import {
  GRADES_RUN_LABEL,
  PER_GRADE_CAP_USD,
} from "../../../domain/score/judge/judge-run.js";
import {
  DID_THE_TASK,
  JUDGE_EVALUATOR_VERSION,
  MADE_NOTHING_UP,
} from "../../../domain/score/judge/rubrics.js";
import { pendingJudgeScore } from "../../../domain/score/judge/judge-score.js";
import type {
  JudgeRunCreator,
  ScoreDeleter,
  ScoreRecorder,
} from "../../../domain/score/ports.js";
import { replaceUnlessGraded } from "../../../domain/score/record.js";
import {
  baseConfig,
  silentLogger,
} from "../../../extensions/__tests__/composed-support.js";
import { GradingCallerRefusedError } from "../../../extensions/grading-caller.js";
import { generateId } from "../../../pipeline/steps/defaults.js";
import { createJudgeActivities } from "../judge-activities.js";
import {
  PLAN_JUDGE_ACTIVITY_NAME,
  POLL_JUDGE_ACTIVITY_NAME,
  RECORD_JUDGE_ACTIVITY_NAME,
  START_JUDGE_ACTIVITY_NAME,
  type JudgeTicket,
} from "../names.js";

let dir: string;
let server: ComposedServer;
let wire: Client<typeof ScoreCommandController>;
let inProcess: Client<typeof ScoreCommandController>;
let scores: Client<typeof ScoreQueryController>;
let evaluators: Client<typeof EvaluatorCommandController>;
let evaluatorQuery: Client<typeof EvaluatorQueryController>;
let agents: Client<typeof AgentCommandController>;
let org: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "judge-composed-test-"));
  server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  wire = createClient(ScoreCommandController, transport);
  scores = createClient(ScoreQueryController, transport);
  evaluators = createClient(EvaluatorCommandController, transport);
  evaluatorQuery = createClient(EvaluatorQueryController, transport);
  agents = createClient(AgentCommandController, transport);
  inProcess = createClient(ScoreCommandController, server.inProcessTransport);
  const created = await createClient(OrganizationCommandController, transport).create({
    apiVersion: "tenancy.stigmer.ai/v1",
    kind: "Organization",
    metadata: { name: "Judge Test Org" },
  });
  org = created.metadata!.id;
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

/** A stored session and a completed run in it, as an engine leaves them. */
async function seedRun(opts: {
  agentId?: string;
  labels?: Record<string, string>;
  phase?: RunPhase;
  structuredOutput?: JsonObject;
  estimatedCostUsd?: number;
  error?: string;
} = {}): Promise<Run> {
  const sessionId = generateId("ses");
  await server.store.saveResource(
    ApiResourceKind.session,
    sessionId,
    SessionSchema,
    create(SessionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { id: sessionId, name: sessionId, slug: sessionId, org },
    }),
  );
  const runId = generateId("run");
  const run = create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: { id: runId, name: runId, slug: runId, org, labels: opts.labels ?? {} },
    spec: { target: { case: "sessionId", value: sessionId }, message: "Summarize the release." },
    status: {
      phase: opts.phase ?? RunPhase.RUN_COMPLETED,
      agentId: opts.agentId ?? "",
      error: opts.error ?? "",
      ...(opts.structuredOutput === undefined ? {} : { structuredOutput: opts.structuredOutput }),
      streamingUsage: { estimatedCostUsd: opts.estimatedCostUsd ?? 0, model: "claude-haiku-4-5" },
    },
  });
  await server.store.saveResource(ApiResourceKind.run, runId, RunSchema, run);
  return run;
}

function judgeScore(runId: string, opts: { passed?: boolean; model?: string; pending?: boolean } = {}): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: { org },
    spec: {
      runId,
      metric: "judge",
      source: ScoreSource.judge,
      evaluatorVersion: JUDGE_EVALUATOR_VERSION,
      judgeModel: opts.model ?? "",
      ...(opts.passed === undefined ? {} : { value: { case: "passed", value: opts.passed } }),
    },
    ...(opts.pending === true ? { status: { state: ScoreState.pending } } : {}),
  });
}

function checkScore(runId: string, graded: boolean): Score {
  return create(ScoreSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Score",
    metadata: { org },
    spec: {
      runId,
      metric: "run-health",
      source: ScoreSource.check,
      evaluatorVersion: "checks-v1",
      ...(graded ? { value: { case: "passed", value: true } } : {}),
    },
    ...(graded ? {} : { status: { notGradedReason: "grading could not start" } }),
  });
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to fail");
}

async function scoresOf(runId: string, metric: string): Promise<Score[]> {
  return (await scores.listByRun({ runId })).items.filter((score) => score.spec?.metric === metric);
}

/** The server's own score writes, over the in-process lane as `internal`. */
const recorder: ScoreRecorder = { record: (score) => inProcess.create(score) };
const deleter: ScoreDeleter = {
  delete: async (scoreId) => {
    await inProcess.delete({ value: scoreId });
  },
};

const writeDeps = () => ({ store: server.store, logger: silentLogger, recorder, deleter });

describe("judge scores", () => {
  it("come from the server alone, pending when it asks, and one per rubric version", async () => {
    const run = await seedRun();
    const runId = run.metadata!.id;
    const refused = await failureOf(wire.create(judgeScore(runId, { passed: true })));
    expect(refused.code).toBe(Code.PermissionDenied);
    expect(refused.rawMessage).toBe(JUDGE_SOURCE_REFUSED_MESSAGE);

    const pending = await inProcess.create(judgeScore(runId, { pending: true }));
    expect(pending.status?.state).toBe(ScoreState.pending);
    expect(pending.spec?.value.case).toBeUndefined();

    const again = await failureOf(inProcess.create(judgeScore(runId, { passed: true })));
    expect(again.code).toBe(Code.AlreadyExists);
    expect(again.rawMessage).toBe(judgeExistsMessage(pending.metadata!.id));

    const modelOnCheck = checkScore(runId, true);
    modelOnCheck.spec!.judgeModel = "claude-haiku-4-5";
    const refusedModel = await failureOf(inProcess.create(modelOnCheck));
    expect(refusedModel.code).toBe(Code.InvalidArgument);
    expect(refusedModel.rawMessage).toBe(SCORE_JUDGE_MODEL_JUDGE_ONLY_MESSAGE);

    const wrongMetric = judgeScore(runId, { passed: true });
    wrongMetric.spec!.metric = "run-health";
    expect((await failureOf(inProcess.create(wrongMetric))).code).toBe(Code.InvalidArgument);
  });
});

describe("replaceUnlessGraded", () => {
  it("keeps the grade in the stigmer#2057 interleave: a placeholder written before the grade's create is replaced", async () => {
    const runId = (await seedRun()).metadata!.id;
    // The observer's late fallback lands between the activity's read and its create.
    await inProcess.create(checkScore(runId, false));
    expect(await replaceUnlessGraded(writeDeps(), checkScore(runId, true))).toBe("recorded");
    const health = await scoresOf(runId, "run-health");
    expect(health).toHaveLength(1);
    expect(health[0]?.status?.state).toBe(ScoreState.graded);
  });

  it("never lets a placeholder replace a grade", async () => {
    const runId = (await seedRun()).metadata!.id;
    await inProcess.create(checkScore(runId, true));
    expect(await replaceUnlessGraded(writeDeps(), checkScore(runId, false))).toBe("kept");
    expect((await scoresOf(runId, "run-health"))[0]?.status?.state).toBe(ScoreState.graded);
  });

  it("replaces a judge's pending score with its grade, and keeps the first of two pending writes", async () => {
    const run = await seedRun();
    const runId = run.metadata!.id;
    expect(await replaceUnlessGraded(writeDeps(), pendingJudgeScore(run))).toBe("recorded");
    expect(await replaceUnlessGraded(writeDeps(), pendingJudgeScore(run))).toBe("kept");
    expect(await replaceUnlessGraded(writeDeps(), judgeScore(runId, { passed: false }))).toBe("recorded");
    const judged = await scoresOf(runId, "judge");
    expect(judged).toHaveLength(1);
    expect(judged[0]?.spec?.value).toEqual({ case: "passed", value: false });
  });

  it("answers run-gone for a run that does not exist", async () => {
    expect(await replaceUnlessGraded(writeDeps(), judgeScore("run_01jzzzzzzzzzzzzzzzzzzzzzzz", { passed: true }))).toBe(
      "run-gone",
    );
  });
});

async function newAgent(): Promise<string> {
  const agent = await agents.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Agent",
    metadata: { name: generateId("graded"), org },
    spec: { instructions: "Summarize.", description: "graded agent" },
  });
  return agent.metadata!.id;
}

async function newEvaluator(agentId: string, spec: { sampleRate?: number; monthlyLimitUsd?: number; enabled?: boolean } = {}) {
  return evaluators.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Evaluator",
    metadata: { org },
    spec: {
      agentId,
      enabled: spec.enabled ?? true,
      sampleRate: spec.sampleRate ?? 1,
      monthlyLimitUsd: spec.monthlyLimitUsd ?? 10,
    },
  });
}

describe("evaluators", () => {
  it("one per agent, read by agent, updated without losing the month's spend, and gone with the agent", async () => {
    const agentId = await newAgent();
    const created = await newEvaluator(agentId);
    expect(created.metadata?.id).toMatch(/^evl_/);
    const again = await failureOf(newEvaluator(agentId));
    expect(again.code).toBe(Code.AlreadyExists);
    expect(again.findDetails(ErrorInfoSchema)[0]?.reason).toBe(EVALUATOR_EXISTS_REASON);
    expect((await evaluatorQuery.getByAgent({ agentId })).metadata?.id).toBe(created.metadata!.id);

    // A grade's reservation lands between the person's read and their save.
    const read = await evaluatorQuery.get({ value: created.metadata!.id });
    expect(await reserve(server.store, created.metadata!.id, new Date(), PER_GRADE_CAP_USD, "limit")).toBe("reserved");
    const saved = await evaluators.update({ ...read, spec: { ...read.spec!, sampleRate: 0.5 } });
    expect(saved.spec?.sampleRate).toBe(0.5);
    expect(saved.status?.reservedUsd, "the reservation written meanwhile is kept").toBe(PER_GRADE_CAP_USD);

    await agents.delete({ value: agentId });
    expect((await failureOf(evaluatorQuery.get({ value: created.metadata!.id }))).code).toBe(Code.NotFound);
    expect((await failureOf(evaluatorQuery.getByAgent({ agentId }))).code).toBe(Code.NotFound);
  });
});

/** The judge run's create and its session's delete, played on the store. */
function judgeLane(judgeOutcome: Partial<Parameters<typeof seedRun>[0]> | ConnectError) {
  const created: Run[] = [];
  const deletedSessions: string[] = [];
  const runs: JudgeRunCreator = {
    async create(request) {
      if (judgeOutcome instanceof ConnectError) throw judgeOutcome;
      const judge = await seedRun({ ...judgeOutcome, labels: request.metadata?.labels ?? {} });
      // The created run answers to the request's fixed name, as the create chain makes it.
      judge.metadata!.slug = request.metadata?.name ?? "";
      judge.spec!.structuredOutputSchema = request.spec?.structuredOutputSchema;
      await server.store.saveResource(ApiResourceKind.run, judge.metadata!.id, RunSchema, judge);
      created.push(judge);
      return judge;
    },
    terminate: async () => undefined,
  };
  return {
    created,
    deletedSessions,
    activities: createJudgeActivities({
      store: server.store,
      logger: silentLogger,
      recorder: () => recorder,
      deleter: () => deleter,
      runs: () => runs,
      sessions: () => ({
        delete: async (sessionId) => {
          deletedSessions.push(sessionId);
          await server.store.deleteResource(ApiResourceKind.session, sessionId);
        },
      }),
      gradingCaller: undefined,
    }),
  };
}

const VERDICT: JsonObject = {
  [DID_THE_TASK]: { result: "passed", reason: "It summarized the release." },
  [MADE_NOTHING_UP]: { result: "failed", reason: "It claims tests ran; no tool ran tests." },
};

async function evaluatorStatus(evaluatorId: string) {
  return (await server.store.getResource(ApiResourceKind.evaluator, evaluatorId, EvaluatorSchema)).status;
}

describe("the judge's activities", () => {
  it("grade a sampled run: pending, one judge run, the verdict, the session gone and the budget settled", async () => {
    const agentId = await newAgent();
    const evaluator = await newEvaluator(agentId);
    const judged = await seedRun({ agentId });
    const runId = judged.metadata!.id;
    const lane = judgeLane({ structuredOutput: VERDICT, estimatedCostUsd: 0.012 });

    const plan = await lane.activities[PLAN_JUDGE_ACTIVITY_NAME](runId);
    expect(plan.kind).toBe("grade");
    if (plan.kind !== "grade") return;
    expect((await scoresOf(runId, "judge"))[0]?.status?.state).toBe(ScoreState.pending);
    expect((await evaluatorStatus(evaluator.metadata!.id))?.reservedUsd).toBe(PER_GRADE_CAP_USD);

    const start = await lane.activities[START_JUDGE_ACTIVITY_NAME](runId, plan.ticket);
    const retried = await lane.activities[START_JUDGE_ACTIVITY_NAME](runId, plan.ticket);
    expect(start.kind).toBe("started");
    expect(retried, "a retried start finds the run an earlier attempt created").toEqual(start);
    expect(lane.created).toHaveLength(1);
    if (start.kind !== "started") return;
    expect(await lane.activities[POLL_JUDGE_ACTIVITY_NAME](start.judgeRunId)).toBe(true);

    await lane.activities[RECORD_JUDGE_ACTIVITY_NAME](runId, plan.ticket, start.judgeRunId, "");
    const [verdict] = await scoresOf(runId, "judge");
    expect(verdict?.status?.state).toBe(ScoreState.graded);
    expect(verdict?.spec?.value).toEqual({ case: "passed", value: false });
    expect(verdict?.spec?.judgeModel).toBe("claude-haiku-4-5");
    expect(verdict?.spec?.criteria.map((c) => [c.name, c.result, c.reason])).toEqual([
      [DID_THE_TASK, CriterionResult.passed, "It summarized the release."],
      [MADE_NOTHING_UP, CriterionResult.failed, "It claims tests ran; no tool ran tests."],
    ]);
    expect(lane.deletedSessions).toHaveLength(1);
    const status = await evaluatorStatus(evaluator.metadata!.id);
    expect(status?.reservedUsd).toBe(0);
    expect(status?.spentUsd).toBe(0.012);
    expect(status?.graded).toBe(1);

    expect(await lane.activities[PLAN_JUDGE_ACTIVITY_NAME](runId), "a graded run is not graded twice").toEqual({
      kind: "skip",
    });
  });

  for (const [what, outcome, reason] of [
    ["an unreadable answer", { structuredOutput: { verdict: "fine" } }, JUDGE_UNREADABLE_REASON],
    ["a judge stopped at its cost cap", { phase: RunPhase.RUN_TERMINATED }, JUDGE_COST_CAP_REASON],
    ["a failed judge run", { phase: RunPhase.RUN_FAILED, error: "model unavailable" }, `${JUDGE_RUN_FAILED_REASON}: model unavailable`],
  ] as const) {
    it(`leave the run not graded, settled and cleaned up, for ${what}`, async () => {
      const agentId = await newAgent();
      const evaluator = await newEvaluator(agentId);
      const runId = (await seedRun({ agentId })).metadata!.id;
      const lane = judgeLane(outcome);
      const plan = await lane.activities[PLAN_JUDGE_ACTIVITY_NAME](runId);
      if (plan.kind !== "grade") throw new Error("expected a grade");
      const start = await lane.activities[START_JUDGE_ACTIVITY_NAME](runId, plan.ticket);
      if (start.kind !== "started") throw new Error("expected a start");
      await lane.activities[RECORD_JUDGE_ACTIVITY_NAME](runId, plan.ticket, start.judgeRunId, "");
      const [score] = await scoresOf(runId, "judge");
      expect(score?.status?.state).toBe(ScoreState.not_graded);
      expect(score?.status?.notGradedReason).toBe(reason);
      expect(score?.spec?.value.case).toBeUndefined();
      expect(lane.deletedSessions).toHaveLength(1);
      const status = await evaluatorStatus(evaluator.metadata!.id);
      expect(status?.reservedUsd).toBe(0);
      expect(status?.lastNotGradedReason).toBe(reason);
    });
  }

  it("answer a credit refusal as out of credit and any other refusal as not started", async () => {
    const agentId = await newAgent();
    await newEvaluator(agentId);
    for (const [refusal, reason] of [
      [new ConnectError("Insufficient credits to start execution", Code.FailedPrecondition), JUDGE_OUT_OF_CREDIT_REASON],
      [new ConnectError("organization is being deleted", Code.PermissionDenied), JUDGE_NOT_STARTED_REASON],
    ] as const) {
      const runId = (await seedRun({ agentId })).metadata!.id;
      const lane = judgeLane(refusal);
      const plan = await lane.activities[PLAN_JUDGE_ACTIVITY_NAME](runId);
      if (plan.kind !== "grade") throw new Error("expected a grade");
      const start = await lane.activities[START_JUDGE_ACTIVITY_NAME](runId, plan.ticket);
      expect(start.kind).toBe("refused");
      if (start.kind !== "refused") return;
      await lane.activities[RECORD_JUDGE_ACTIVITY_NAME](runId, plan.ticket, "", start.failure);
      expect((await scoresOf(runId, "judge"))[0]?.status?.notGradedReason).toBe(reason);
    }
  });

  it("throw a capacity refusal for the workflow's retries", async () => {
    const agentId = await newAgent();
    await newEvaluator(agentId);
    const runId = (await seedRun({ agentId })).metadata!.id;
    const lane = judgeLane(new ConnectError("at capacity", Code.ResourceExhausted));
    const plan = await lane.activities[PLAN_JUDGE_ACTIVITY_NAME](runId);
    if (plan.kind !== "grade") throw new Error("expected a grade");
    await expect(lane.activities[START_JUDGE_ACTIVITY_NAME](runId, plan.ticket)).rejects.toMatchObject({
      type: "JudgeBusy",
    });
  });

  it("record the limit's refusal without a judge, and skip judge runs, runs of no agent and runs outside the sample", async () => {
    const limited = await newAgent();
    const evaluator = await newEvaluator(limited, { monthlyLimitUsd: 0.1 });
    const runId = (await seedRun({ agentId: limited })).metadata!.id;
    const lane = judgeLane({});
    expect(await lane.activities[PLAN_JUDGE_ACTIVITY_NAME](runId)).toEqual({ kind: "recorded" });
    expect((await scoresOf(runId, "judge"))[0]?.status?.notGradedReason).toBe(JUDGE_LIMIT_REACHED_REASON);
    expect((await evaluatorStatus(evaluator.metadata!.id))?.lastNotGradedReason).toBe(JUDGE_LIMIT_REACHED_REASON);

    const sampledOut = await newAgent();
    await newEvaluator(sampledOut, { sampleRate: 0.0001 });
    const off = await newAgent();
    await newEvaluator(off, { enabled: false });
    const graded = await newAgent();
    await newEvaluator(graded);
    for (const run of [
      await seedRun({ agentId: sampledOut }),
      await seedRun({ agentId: off }),
      await seedRun(),
      await seedRun({ agentId: graded, labels: { [GRADES_RUN_LABEL]: "run_other" } }),
      await seedRun({ agentId: graded, phase: RunPhase.RUN_FAILED }),
    ]) {
      expect(await lane.activities[PLAN_JUDGE_ACTIVITY_NAME](run.metadata!.id)).toEqual({ kind: "skip" });
    }
    expect(lane.created).toHaveLength(0);
  });

  it("answer a grading caller that can act as nobody as cannot-act", async () => {
    const agentId = await newAgent();
    await newEvaluator(agentId);
    const runId = (await seedRun({ agentId })).metadata!.id;
    const activities = createJudgeActivities({
      store: server.store,
      logger: silentLogger,
      recorder: () => recorder,
      deleter: () => deleter,
      runs: () => {
        throw new Error("no judge run may be created");
      },
      sessions: () => ({ delete: async () => undefined }),
      gradingCaller: {
        mintGradingCaller: async () => {
          throw new GradingCallerRefusedError("the evaluator's creator has left");
        },
      },
    });
    const ticket: JudgeTicket = { evaluatorId: "evl_x", modelName: "", capUsd: PER_GRADE_CAP_USD };
    expect(await activities[START_JUDGE_ACTIVITY_NAME](runId, ticket)).toEqual({
      kind: "refused",
      failure: "cannot-act",
    });
  });
});
