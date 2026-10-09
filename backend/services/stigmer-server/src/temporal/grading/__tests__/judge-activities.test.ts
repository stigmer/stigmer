/**
 * Pins the judge activities' edges over a real store with doubles for the
 * score chains and the judge run's lane, where judge-composed.test.ts pins
 * the main paths through the composed server:
 *   - plan: an evaluator switched off between its read and the
 *     reservation leaves no pending score; a judged run deleted meanwhile
 *     is skipped;
 *   - start: a judged run that is gone is not started; an earlier attempt's
 *     judge run is found by name, also when the create loses the race; an
 *     infrastructure fault from the grading caller, the create or a store
 *     read is thrown for Temporal to retry; a refusal the start does not
 *     know is thrown;
 *   - record: a judge still running is stopped (and one that cannot be is
 *     logged, any other stop fault thrown); a session already gone or held
 *     by an active run is left, any other delete fault thrown; each failure
 *     the workflow saw is recorded with its reason; a judge that vanished,
 *     a judge still running with no failure and a failed judge with no
 *     error each have their reason; a judged run deleted while its score
 *     was written has the score removed and the grade only gives its money
 *     back.
 */
import { clone, create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreState } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import {
  JUDGE_BUSY_REASON,
  JUDGE_NOT_FINISHED_REASON,
  JUDGE_RUN_FAILED_REASON,
} from "../../../domain/score/constants.js";
import {
  PER_GRADE_CAP_USD,
  judgeRunName,
} from "../../../domain/score/judge/judge-run.js";
import { JUDGE_EVALUATOR_VERSION } from "../../../domain/score/judge/rubrics.js";
import type {
  JudgeRunCreator,
  JudgeSessionDeleter,
  ScoreDeleter,
  ScoreRecorder,
} from "../../../domain/score/ports.js";
import { listRunScores } from "../../../domain/score/queries.js";
import { silentLogger } from "../../../extensions/__tests__/composed-support.js";
import type { GradingCallerMint } from "../../../extensions/grading-caller.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { createJudgeActivities } from "../judge-activities.js";
import {
  GRADE_ALREADY_GRADED,
  GRADE_RECORDED,
  GRADE_RUN_GONE,
  PLAN_JUDGE_ACTIVITY_NAME,
  POLL_JUDGE_ACTIVITY_NAME,
  RECORD_JUDGE_ACTIVITY_NAME,
  START_JUDGE_ACTIVITY_NAME,
  type JudgeTicket,
} from "../names.js";

let temp: TempStore;
let written = 0;

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

const TICKET: JudgeTicket = { evaluatorId: "evl_1", modelName: "", capUsd: PER_GRADE_CAP_USD };

/** The score's create chain as far as the activities see it: one score per writer and version. */
function recorder(store: () => Store = () => temp.store): ScoreRecorder {
  return {
    async record(score) {
      const runId = score.spec?.runId ?? "";
      const run = await store().getResource(ApiResourceKind.run, runId, RunSchema).catch(() => undefined);
      if (run === undefined) {
        throw new ConnectError("Run not found", Code.NotFound);
      }
      const held = (await listRunScores(store(), silentLogger, runId)).some(
        (other) => other.spec?.metric === score.spec?.metric && other.spec?.evaluatorVersion === score.spec?.evaluatorVersion,
      );
      if (held) {
        throw new ConnectError("exists", Code.AlreadyExists);
      }
      written++;
      const id = `scr_judge${written}`;
      const stored = clone(ScoreSchema, score);
      stored.metadata = { ...stored.metadata!, id, name: id, slug: id };
      stored.status = create(ScoreStatusSchema, {
        notGradedReason: stored.status?.notGradedReason ?? "",
        state:
          stored.spec?.value.case !== undefined
            ? ScoreState.graded
            : stored.status?.state === ScoreState.pending
              ? ScoreState.pending
              : ScoreState.not_graded,
      });
      await store().saveResource(ApiResourceKind.score, id, ScoreSchema, stored);
      return stored;
    },
  };
}

const deleter: ScoreDeleter = {
  delete: async (scoreId) => {
    await temp.store.deleteResource(ApiResourceKind.score, scoreId);
  },
};

interface Lane {
  readonly recorder?: ScoreRecorder;
  readonly runs?: Partial<JudgeRunCreator>;
  readonly sessions?: JudgeSessionDeleter;
  readonly gradingCaller?: GradingCallerMint;
  readonly store?: Store;
}

function activities(lane: Lane = {}) {
  const store = lane.store ?? temp.store;
  return createJudgeActivities({
    store,
    logger: silentLogger,
    recorder: () => lane.recorder ?? recorder(() => store),
    deleter: () => deleter,
    runs: () => ({
      create: lane.runs?.create ?? (() => Promise.reject(new Error("no judge run expected"))),
      terminate: lane.runs?.terminate ?? (() => Promise.resolve()),
    }),
    sessions: () => lane.sessions ?? { delete: () => Promise.resolve() },
    gradingCaller: lane.gradingCaller,
  });
}

async function seedRun(id: string, opts: Partial<{ agentId: string; phase: RunPhase; name: string; sessionId: string; error: string; cost: number }> = {}): Promise<Run> {
  const run = create(RunSchema, {
    metadata: { id, name: opts.name ?? id, slug: opts.name ?? id, org: "org_1" },
    spec: { target: { case: "sessionId", value: opts.sessionId ?? "ses_1" }, message: "summarize" },
    status: {
      phase: opts.phase ?? RunPhase.RUN_COMPLETED,
      agentId: opts.agentId ?? "",
      error: opts.error ?? "",
      streamingUsage: { estimatedCostUsd: opts.cost ?? 0 },
    },
  });
  await temp.store.saveResource(ApiResourceKind.run, id, RunSchema, run);
  return run;
}

async function seedEvaluator(enabled = true): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.evaluator,
    "evl_1",
    EvaluatorSchema,
    create(EvaluatorSchema, {
      metadata: { id: "evl_1", name: "evl_1", org: "org_1" },
      spec: { agentId: "agt_1", enabled, sampleRate: 1, monthlyLimitUsd: 10 },
    }),
  );
}

async function judgeScores(runId: string): Promise<Score[]> {
  return (await listRunScores(temp.store, silentLogger, runId)).filter((score) => score.spec?.metric === "judge");
}

/** A store whose evaluator writes find nothing, as when the row went between a read and a write. */
function evaluatorGoneOnWrite(store: Store): Store {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (property === "updateResource") {
        return async (kind: ApiResourceKind, ...rest: unknown[]) => {
          if (kind === ApiResourceKind.evaluator) {
            throw new ResourceNotFoundError(`evaluator ${String(rest[0])}`);
          }
          return (target.updateResource as (...args: unknown[]) => unknown).call(target, kind, ...rest);
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("plan-judge", () => {
  it("leaves no pending score when the evaluator went between its read and the reservation", async () => {
    await seedEvaluator();
    await seedRun("run_1", { agentId: "agt_1" });
    const plan = await activities({ store: evaluatorGoneOnWrite(temp.store) })[PLAN_JUDGE_ACTIVITY_NAME]("run_1");
    expect(plan).toEqual({ kind: "skip" });
    expect(await judgeScores("run_1")).toEqual([]);
  });

  it("skips a run deleted between its read and its pending score", async () => {
    await seedEvaluator();
    await seedRun("run_1", { agentId: "agt_1" });
    const vanished: ScoreRecorder = { record: () => Promise.reject(new ConnectError("Run not found", Code.NotFound)) };
    expect(await activities({ recorder: vanished })[PLAN_JUDGE_ACTIVITY_NAME]("run_1")).toEqual({ kind: "skip" });
  });

  it("skips a run deleted before it was planned", async () => {
    expect(await activities()[PLAN_JUDGE_ACTIVITY_NAME]("run_gone")).toEqual({ kind: "skip" });
  });
});

describe("start-judge", () => {
  it("starts nothing for a judged run that is gone", async () => {
    expect(await activities()[START_JUDGE_ACTIVITY_NAME]("run_gone", TICKET)).toEqual({
      kind: "refused",
      failure: "not-started",
    });
  });

  it("finds an earlier attempt's judge run by its name, also when the create loses the race", async () => {
    await seedRun("run_1");
    const racing = activities({
      runs: {
        create: async () => {
          await seedRun("run_judge_winner", { name: judgeRunName("run_1"), sessionId: "ses_judge" });
          throw new ConnectError("exists", Code.AlreadyExists);
        },
      },
    });
    expect(await racing[START_JUDGE_ACTIVITY_NAME]("run_1", TICKET)).toEqual({
      kind: "started",
      judgeRunId: "run_judge_winner",
    });
    expect(await activities()[START_JUDGE_ACTIVITY_NAME]("run_1", TICKET)).toEqual({
      kind: "started",
      judgeRunId: "run_judge_winner",
    });
  });

  it("throws what Temporal should retry: a lost race with no winner, a caller fault, a create fault, an unknown refusal", async () => {
    await seedRun("run_1");
    const lostRace = activities({ runs: { create: () => Promise.reject(new ConnectError("exists", Code.AlreadyExists)) } });
    await expect(lostRace[START_JUDGE_ACTIVITY_NAME]("run_1", TICKET)).rejects.toThrow("exists");
    const callerFault = activities({
      gradingCaller: { mintGradingCaller: () => Promise.reject(new Error("account store down")) },
    });
    await expect(callerFault[START_JUDGE_ACTIVITY_NAME]("run_1", TICKET)).rejects.toThrow("account store down");
    const createFault = activities({ runs: { create: () => Promise.reject(new Error("socket closed")) } });
    await expect(createFault[START_JUDGE_ACTIVITY_NAME]("run_1", TICKET)).rejects.toThrow("socket closed");
    const unknown = activities({ runs: { create: () => Promise.reject(new ConnectError("engine down", Code.Unavailable)) } });
    await expect(unknown[START_JUDGE_ACTIVITY_NAME]("run_1", TICKET)).rejects.toThrow("engine down");
  });

  it("creates the judge run as the minted caller", async () => {
    await seedRun("run_1");
    const callers: unknown[] = [];
    const minted = activities({
      gradingCaller: {
        mintGradingCaller: async () => ({ identityId: "ida_grading", callerClass: "grading", issuer: "stigmer", rawToken: "t" }),
      },
      runs: {
        create: async (request, caller) => {
          callers.push(caller?.identityId);
          return seedRun("run_judge", { name: request.metadata?.name ?? "" });
        },
      },
    });
    expect(await minted[START_JUDGE_ACTIVITY_NAME]("run_1", TICKET)).toEqual({ kind: "started", judgeRunId: "run_judge" });
    expect(callers).toEqual(["ida_grading"]);
  });
});

describe("poll-judge", () => {
  it("answers ended for a judge run that is gone or terminal, and running otherwise", async () => {
    await seedRun("run_judge", { phase: RunPhase.RUN_IN_PROGRESS });
    expect(await activities()[POLL_JUDGE_ACTIVITY_NAME]("run_judge")).toBe(false);
    expect(await activities()[POLL_JUDGE_ACTIVITY_NAME]("run_gone")).toBe(true);
  });
});

describe("record-judge", () => {
  it("stops a judge still running and records it not finished, leaving a session an active run holds", async () => {
    await seedEvaluator();
    await seedRun("run_1");
    await seedRun("run_judge", { phase: RunPhase.RUN_IN_PROGRESS, sessionId: "ses_judge", cost: 0.02 });
    const stopped: string[] = [];
    const recordActivity = activities({
      runs: {
        terminate: async (runId) => {
          stopped.push(runId);
        },
      },
      sessions: { delete: () => Promise.reject(new ConnectError("a run is active", Code.FailedPrecondition)) },
    })[RECORD_JUDGE_ACTIVITY_NAME];
    expect(await recordActivity("run_1", TICKET, "run_judge", "not-finished")).toBe(GRADE_RECORDED);
    expect(stopped).toEqual(["run_judge"]);
    expect((await judgeScores("run_1"))[0]?.status?.notGradedReason).toBe(JUDGE_NOT_FINISHED_REASON);
  });

  it("logs a judge that cannot be stopped, and throws any other stop or delete fault", async () => {
    await seedEvaluator();
    await seedRun("run_1");
    await seedRun("run_2");
    await seedRun("run_judge", { phase: RunPhase.RUN_IN_PROGRESS, sessionId: "ses_judge" });
    const parked = activities({
      runs: { terminate: () => Promise.reject(new ConnectError("waiting for approval", Code.FailedPrecondition)) },
      sessions: { delete: () => Promise.reject(new ConnectError("gone", Code.NotFound)) },
    });
    expect(await parked[RECORD_JUDGE_ACTIVITY_NAME]("run_1", TICKET, "run_judge", "not-finished")).toBe(GRADE_RECORDED);
    const broken = activities({ runs: { terminate: () => Promise.reject(new Error("engine down")) } });
    await expect(broken[RECORD_JUDGE_ACTIVITY_NAME]("run_2", TICKET, "run_judge", "not-finished")).rejects.toThrow("engine down");
    const deleteFault = activities({ sessions: { delete: () => Promise.reject(new Error("store down")) } });
    await seedRun("run_judge", { phase: RunPhase.RUN_COMPLETED, sessionId: "ses_judge" });
    await expect(deleteFault[RECORD_JUDGE_ACTIVITY_NAME]("run_2", TICKET, "run_judge", "")).rejects.toThrow("store down");
  });

  it("records each failure and each judge end with its reason", async () => {
    await seedEvaluator();
    const cases: Array<[string, Parameters<typeof seedRun>[1] | undefined, string, string]> = [
      ["run_busy", undefined, "busy", JUDGE_BUSY_REASON],
      ["run_vanished", undefined, "", JUDGE_RUN_FAILED_REASON],
      ["run_failed_silently", { phase: RunPhase.RUN_FAILED }, "", JUDGE_RUN_FAILED_REASON],
      ["run_cancelled", { phase: RunPhase.RUN_CANCELLED, error: "cancelled by the operator" }, "", `${JUDGE_RUN_FAILED_REASON}: cancelled by the operator`],
      ["run_still_running", { phase: RunPhase.RUN_IN_PROGRESS }, "", JUDGE_NOT_FINISHED_REASON],
    ];
    for (const [runId, judge, failure, reason] of cases) {
      await seedRun(runId);
      let judgeRunId = "";
      if (judge !== undefined) {
        judgeRunId = `${runId}_judge`;
        await seedRun(judgeRunId, { ...judge, sessionId: `ses_${runId}` });
      } else if (runId === "run_vanished") {
        judgeRunId = "run_never_stored";
      }
      await activities()[RECORD_JUDGE_ACTIVITY_NAME](runId, TICKET, judgeRunId, failure as "" | "busy");
      expect((await judgeScores(runId))[0]?.status?.notGradedReason, runId).toBe(reason);
    }
  });

  it("removes the score it wrote when the judged run went meanwhile, and only gives the grade's money back", async () => {
    await seedEvaluator();
    await seedRun("run_1");
    const goesWhileWritten = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "saveResource") {
          return async (kind: ApiResourceKind, ...rest: unknown[]) => {
            await (target.saveResource as (...args: unknown[]) => Promise<void>).call(target, kind, ...rest);
            if (kind === ApiResourceKind.score) {
              await target.deleteResource(ApiResourceKind.run, "run_1");
            }
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const outcome = await activities({ store: goesWhileWritten })[RECORD_JUDGE_ACTIVITY_NAME]("run_1", TICKET, "", "busy");
    expect(outcome).toBe(GRADE_RUN_GONE);
    expect(await judgeScores("run_1")).toEqual([]);
    const evaluator = await temp.store.getResource(ApiResourceKind.evaluator, "evl_1", EvaluatorSchema);
    expect(evaluator.status?.notGraded ?? 0, "a deleted run's grade counts nothing").toBe(0);
  });

  it("answers gone for a judged run deleted before its score, keeps a grade already there, and deletes no session a judge run never named", async () => {
    await seedEvaluator();
    const vanished: ScoreRecorder = { record: () => Promise.reject(new ConnectError("Run not found", Code.NotFound)) };
    await seedRun("run_1");
    expect(await activities({ recorder: vanished })[RECORD_JUDGE_ACTIVITY_NAME]("run_1", TICKET, "", "busy")).toBe(GRADE_RUN_GONE);

    await seedRun("run_2");
    const graded = await recorder().record(
      create(ScoreSchema, {
        metadata: { org: "org_1" },
        spec: { runId: "run_2", metric: "judge", evaluatorVersion: JUDGE_EVALUATOR_VERSION, value: { case: "passed", value: true } },
      }),
    );
    expect(graded.status?.state).toBe(ScoreState.graded);
    const sessionless = create(RunSchema, {
      metadata: { id: "run_judge_nosession", name: "run_judge_nosession", org: "org_1" },
      status: { phase: RunPhase.RUN_FAILED },
    });
    await temp.store.saveResource(ApiResourceKind.run, "run_judge_nosession", RunSchema, sessionless);
    const deleted: string[] = [];
    const outcome = await activities({ sessions: { delete: async (id) => void deleted.push(id) } })[RECORD_JUDGE_ACTIVITY_NAME](
      "run_2",
      TICKET,
      "run_judge_nosession",
      "",
    );
    expect(outcome).toBe(GRADE_ALREADY_GRADED);
    expect(deleted).toEqual([]);
  });

  it("throws a store fault reading a run, for Temporal to retry", async () => {
    const faulty = new Proxy(temp.store, {
      get(target, property, receiver) {
        if (property === "getResource") {
          return () => Promise.reject(new Error("disk full"));
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    await expect(activities({ store: faulty })[POLL_JUDGE_ACTIVITY_NAME]("run_x")).rejects.toThrow("disk full");
  });
});
