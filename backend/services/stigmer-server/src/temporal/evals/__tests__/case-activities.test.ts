/**
 * Pins the case activities' refusals, gaps and fallbacks, over a real
 * store, a real suite read by `readEvalSuite`, and doubles for the lane,
 * the session delete, the caller seam and the logger. activities.test.ts
 * drives each activity's main path; this file drives every answer beside
 * it:
 *
 *   - start-try: no caller seam (the try acts as the server); a seam that
 *     throws for another reason than a refusal; an eval with no spec; a
 *     retry with no earlier run; a run under the try's name adopted on a
 *     first attempt too; the attempt read from the activity
 *     context; a plugin moved past the eval's version (no try starts); a
 *     create that fails outside the RPC contract, an RPC code
 *     no refusal covers, an empty and an over-long refusal; a refused run
 *     whose session has no id;
 *   - stop-run: a failure other than "already ended or gone" is thrown;
 *   - grade-try: the evidence an AI-graded check cannot be shown (no file
 *     record, an offloaded file and no artifact storage, a reference
 *     transcript the archive lacks); the run's error named per phase when
 *     the run carries none; the duration with missing or reversed stamps;
 *     a run its own cap stopped at the try's budget leaves every check not
 *     graded, where the deadline's stop, a lower cap's stop and the
 *     platform's other stops are graded;
 *   - start-vote: a try, eval or grader gone; evidence that is not text;
 *     the reference transcript in the vote's message, or missing; a caller
 *     the seam refuses; a refused create (credit, the run's own reason, a
 *     failure outside the RPC contract);
 *   - read-vote: a vote run gone; an answer that cannot be read; each
 *     ended phase; its session kept, so a read retried after a lost answer
 *     reads the same vote and cost;
 *   - delete-vote: the vote's session deleted, once and again; a vote run
 *     gone; a session already gone, one whose delete fails, a vote with no
 *     session;
 *   - try-spend: no run found is no spend; the try's run found by label
 *     and name, its cost and its stored votes' added;
 *   - record-score: an eval gone; a grader the grade has no outcome for;
 *     a run that has not ended keeps its score on the eval only.
 *
 * The suite here is one case with the two AI-graded types: a `baseline`
 * check over a reference transcript and an `llm` check over one file.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeKind,
  FileReviewEventType,
  MessageType,
  RunPhase,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  CapturedFileChangeSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import type { FileReviewEvent } from "@stigmer/protos/ai/stigmer/agentic/run/v1/filereview_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { LogFields, Logger } from "../../../boot/logger.js";
import { newPatternPool } from "../../../domain/plugin-eval/graders/patterns.js";
import { FILES_NOT_RECORDED_REASON } from "../../../domain/plugin-eval/graders/verdict.js";
import {
  JUDGE_COST_CAP_REASON,
  JUDGE_NOT_FINISHED_REASON,
  JUDGE_RUN_FAILED_REASON,
  JUDGE_UNREADABLE_REASON,
} from "../../../domain/score/constants.js";
import type { JudgeSessionDeleter } from "../../../domain/score/ports.js";
import { listRunScores } from "../../../domain/score/queries.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { PLUGIN_LABEL } from "../../../pipeline/apiresource-labels.js";
import type { PluginEvalCallerMint } from "../../../extensions/plugin-eval-caller.js";
import { PluginEvalCallerRefusedError } from "../../../extensions/plugin-eval-caller.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  TRY_GONE_REASON,
  TRY_UNPLANNED_REASON,
  createCaseActivities,
  createSpendActivities,
} from "../case-activities.js";
import type { EvalContextLoader } from "../context.js";
import { newEvalContextLoader } from "../context.js";
import {
  CANNOT_ACT_REASON,
  DELETE_VOTE_ACTIVITY_NAME,
  GRADE_TRY_ACTIVITY_NAME,
  OUT_OF_CREDIT_REASON,
  PLUGIN_UPDATED_REASON,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
  TRY_NOT_STARTED_REASON,
  TRY_SPENDING_SHARE_REASON,
  TRY_SPEND_ACTIVITY_NAME,
} from "../names.js";
import type { CaseInput, TryGrade } from "../names.js";
import type { PluginEvalTryLane } from "../ports.js";
import {
  EVAL_ID,
  ORG,
  PLUGIN_ID,
  catalog,
  lane,
  scoreChain,
  seedEval,
  seedPlugin,
  suiteFiles,
  suiteSource,
} from "./support.js";

const CASE_DIR = "evals/judged-case";
const REFERENCE_PATH = `${CASE_DIR}/reference.jsonl`;

/** One case, its graders in name order: `compare` (baseline), `notes` (llm over NOTES.md). */
const JUDGED_SUITE: Readonly<Record<string, string>> = {
  [`${CASE_DIR}/prompt.md`]: "Write the release notes.\n",
  [REFERENCE_PATH]: [
    JSON.stringify({
      type: "user",
      message: { role: "user", content: "Write the release notes." },
    }),
    JSON.stringify({
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Release notes written." }],
      },
    }),
  ].join("\n"),
  [`${CASE_DIR}/graders/compare.md`]:
    "---\ntype: baseline\nbaseline_file: reference.jsonl\n---\n\nPASS if the notes cover every change.\n",
  [`${CASE_DIR}/graders/notes.md`]:
    "---\ntype: llm\nfocus:\n  source: file\n  path: NOTES.md\n---\n\nPASS if NOTES.md lists the rename.\n",
};

const COMPARE = 0;
const NOTES = 1;

const CELL: CaseInput = {
  evalId: EVAL_ID,
  org: ORG,
  caseIndex: 0,
  targetIndex: 0,
  arm: "with",
  tryIndex: 0,
  timeoutSeconds: 300,
  budgetUsd: 4,
};

const CALLER: CallerIdentity = {
  identityId: "acc_eval",
  callerClass: "user",
} as CallerIdentity;

let temp: TempStore;
const pool = newPatternPool(1);

beforeEach(() => {
  temp = tempStore();
});

afterEach(async () => {
  await temp.cleanup();
});

interface LogLine {
  readonly level: "warn" | "error";
  readonly message: string;
  readonly fields: LogFields | undefined;
}

function capturingLogger(): { logger: Logger; lines: LogLine[] } {
  const lines: LogLine[] = [];
  return {
    lines,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, fields) => lines.push({ level: "warn", message, fields }),
      error: (message, fields) =>
        lines.push({ level: "error", message, fields }),
    },
  };
}

/** The real loader over the judged suite, with `wrap` around it when given. */
function build(
  options: {
    readonly attempt?: () => number;
    readonly caller?: PluginEvalCallerMint | "none";
    readonly wrap?: (real: EvalContextLoader) => EvalContextLoader;
    readonly lane?: (real: PluginEvalTryLane) => PluginEvalTryLane;
    readonly sessions?: JudgeSessionDeleter;
    readonly suite?: Readonly<Record<string, string>>;
  } = {},
) {
  const real = newEvalContextLoader({
    store: temp.store,
    suites: suiteSource(suiteFiles(options.suite ?? JUDGED_SUITE)),
    catalog,
  });
  const doubles = lane(temp.store);
  const chain = scoreChain(temp.store);
  const log = capturingLogger();
  const minted: string[] = [];
  const mint: PluginEvalCallerMint = {
    async mintPluginEvalCaller(_org, evalId) {
      minted.push(evalId);
      return CALLER;
    },
  };
  const tries = options.lane?.(doubles.lane) ?? doubles.lane;
  const cases = createCaseActivities({
    store: temp.store,
    logger: log.logger,
    contexts: options.wrap?.(real) ?? real,
    tries: () => tries,
    sessions: () => options.sessions ?? doubles.sessions,
    recorder: () => chain.recorder,
    deleter: () => chain.deleter,
    readArtifact: undefined,
    pluginEvalCaller:
      options.caller === "none" ? undefined : (options.caller ?? mint),
    patterns: pool,
    ...(options.attempt === undefined
      ? { attempt: () => 1 }
      : { attempt: options.attempt }),
  });
  return { cases, record: doubles.record, lines: log.lines, minted };
}

/** Activities whose attempt is read from the Temporal activity context. */
function buildOnContext() {
  const doubles = lane(temp.store);
  const chain = scoreChain(temp.store);
  const cases = createCaseActivities({
    store: temp.store,
    logger: capturingLogger().logger,
    contexts: newEvalContextLoader({
      store: temp.store,
      suites: suiteSource(suiteFiles(JUDGED_SUITE)),
      catalog,
    }),
    tries: () => doubles.lane,
    sessions: () => doubles.sessions,
    recorder: () => chain.recorder,
    deleter: () => chain.deleter,
    readArtifact: undefined,
    pluginEvalCaller: undefined,
    patterns: pool,
  });
  return { cases, record: doubles.record };
}

async function seeded(): Promise<void> {
  await seedPlugin(temp.store);
  await seedEval(temp.store);
}

/** Starts the try and returns its ids. */
async function startTry(cases: ReturnType<typeof build>["cases"]) {
  const start = await cases[START_TRY_ACTIVITY_NAME](CELL);
  if (start.kind !== "started") {
    throw new Error(`the try did not start: ${JSON.stringify(start)}`);
  }
  return start;
}

/** Replaces the stored run's status. */
async function setStatus(
  runId: string,
  status: MessageInitShape<typeof RunStatusSchema>,
): Promise<void> {
  await temp.store.updateResource(
    ApiResourceKind.run,
    runId,
    RunSchema,
    (live) => {
      live.status = create(RunStatusSchema, status);
    },
  );
}

/** A completed try with a final message and, when given, a file-review ledger. */
async function completeTry(
  runId: string,
  events?: FileReviewEvent[],
): Promise<void> {
  await setStatus(runId, {
    phase: RunPhase.RUN_COMPLETED,
    startedAt: "2026-10-10T10:00:00Z",
    completedAt: "2026-10-10T10:00:12Z",
    messages: [
      { type: MessageType.MESSAGE_HUMAN, content: "Write the release notes." },
      { type: MessageType.MESSAGE_AI, content: "Release notes written." },
    ],
    ...(events === undefined
      ? {}
      : {
          fileReviewEventStream: create(FileReviewEventStreamSchema, {
            events,
          }),
        }),
  });
}

/** A ledger that captured a baseline and, optionally, one candidate. */
function ledger(
  ...changes: MessageInitShape<typeof CapturedFileChangeSchema>[]
): FileReviewEvent[] {
  const events = [
    create(FileReviewEventSchema, {
      changeSetId: "t1",
      eventType: FileReviewEventType.BASELINE_CAPTURED,
    }),
  ];
  if (changes.length > 0) {
    events.push(
      create(FileReviewEventSchema, {
        changeSetId: "t1",
        eventType: FileReviewEventType.CANDIDATE_CAPTURED,
        payload: {
          case: "candidateCaptured",
          value: {
            changeSetId: "t1",
            changes: changes.map((change) =>
              create(CapturedFileChangeSchema, change),
            ),
          },
        },
      }),
    );
  }
  return events;
}

/** The loader answering the real context with the reference transcript gone from the archive. */
function withoutReference(real: EvalContextLoader): EvalContextLoader {
  return async (evalId) => {
    const context = await real(evalId);
    if (context === undefined) {
      return undefined;
    }
    const kept = Object.entries(JUDGED_SUITE).filter(
      ([path]) => path !== REFERENCE_PATH,
    );
    return { ...context, files: inMemoryPluginFiles(new Map(kept)) };
  };
}

describe("start-try beside its main path", () => {
  it("acts as the server when no caller seam is composed", async () => {
    await seeded();
    const { cases, record } = build({ caller: "none" });
    await startTry(cases);
    expect(record.sessions.map((s) => s.caller)).toEqual([undefined]);
    expect(record.runs.map((r) => r.caller)).toEqual([undefined]);
  });

  it("throws a seam failure that is not a refusal, starting nothing", async () => {
    await seeded();
    const { cases, record } = build({
      caller: {
        mintPluginEvalCaller: () =>
          Promise.reject(new Error("the identity store is down")),
      },
    });
    await expect(cases[START_TRY_ACTIVITY_NAME](CELL)).rejects.toThrow(
      "the identity store is down",
    );
    expect(record.sessions).toEqual([]);
  });

  it("refuses an eval whose context carries no spec as no longer planned", async () => {
    await seeded();
    const { cases, record } = build({
      wrap: (real) => async (evalId) => {
        const context = await real(evalId);
        if (context === undefined) return undefined;
        const pluginEval = { ...context.pluginEval, spec: undefined };
        return { ...context, pluginEval };
      },
    });
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual({
      kind: "refused",
      failure: "not-started",
      reason: TRY_UNPLANNED_REASON,
    });
    expect(record.sessions).toEqual([]);
  });

  it("starts no try once the plugin has moved past the eval's version", async () => {
    await seeded();
    const { cases, record } = build({
      wrap: (real) => async (evalId) => {
        const context = await real(evalId);
        if (context === undefined) return undefined;
        const status = { ...context.plugin.status!, digest: "b".repeat(64) };
        return { ...context, plugin: { ...context.plugin, status } };
      },
    });
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual({
      kind: "refused",
      failure: "not-started",
      reason: PLUGIN_UPDATED_REASON,
    });
    expect(record.sessions).toEqual([]);
    expect(record.runs).toEqual([]);
  });

  it("adopts a run under the try's name on a first attempt too, creating no second one", async () => {
    await seeded();
    const slow = build();
    const started = await slow.cases[START_TRY_ACTIVITY_NAME](CELL);
    // Temporal reports attempt 1 again (a reset, a replayed child): the run
    // the first start created is found by its name all the same.
    const again = build({ attempt: () => 1 });
    expect(await again.cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual(started);
    expect(again.record.runs).toEqual([]);
    expect(again.record.sessions).toEqual([]);
  });

  it("starts afresh on a retry that finds no earlier run", async () => {
    await seeded();
    const { cases, record } = build({ attempt: () => 2 });
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual({
      kind: "started",
      sessionId: "ses_1",
      runId: "run_2",
    });
    expect(record.runs).toHaveLength(1);
  });

  it("reads the attempt from the activity context when none is injected", async () => {
    await seeded();
    const first = buildOnContext();
    const started = await new MockActivityEnvironment({ attempt: 1 }).run(
      first.cases[START_TRY_ACTIVITY_NAME],
      CELL,
    );
    const retried = buildOnContext();
    const adopted = await new MockActivityEnvironment({ attempt: 2 }).run(
      retried.cases[START_TRY_ACTIVITY_NAME],
      CELL,
    );
    expect(adopted).toEqual(started);
    expect(retried.record.runs).toEqual([]);
  });

  it("throws a create that fails outside the RPC contract, for the activity's retries", async () => {
    await seeded();
    const { cases } = build({
      lane: (real) => ({
        ...real,
        createRun: () => Promise.reject(new Error("socket hang up")),
      }),
    });
    await expect(cases[START_TRY_ACTIVITY_NAME](CELL)).rejects.toThrow(
      "socket hang up",
    );
  });

  it("throws a refusal code that names no answer, and deletes the refused run's session", async () => {
    await seeded();
    const { cases, record } = build();
    record.refuse = new ConnectError("the database is down", Code.Internal);
    const failure = await cases[START_TRY_ACTIVITY_NAME](CELL).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(ConnectError);
    expect((failure as ConnectError).code).toBe(Code.Internal);
    expect(record.deletedSessions).toEqual(["ses_1"]);
  });

  it("names an empty refusal as not started, and bounds a long one", async () => {
    await seeded();
    const { cases, record } = build();
    record.refuse = new ConnectError("", Code.PermissionDenied);
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual({
      kind: "refused",
      failure: "not-started",
      reason: TRY_NOT_STARTED_REASON,
    });
    record.refuse = new ConnectError("x".repeat(800), Code.InvalidArgument);
    const long = await cases[START_TRY_ACTIVITY_NAME](CELL);
    expect(long).toMatchObject({ kind: "refused", failure: "not-started" });
    expect(long.kind === "refused" && long.reason).toBe("x".repeat(500));
  });

  it("deletes nothing for a refused run whose session came back without an id", async () => {
    await seeded();
    const { cases, record } = build({
      lane: (real) => ({
        ...real,
        createSession: async (session, caller) => {
          const stored = await real.createSession(session, caller);
          return { ...stored, metadata: undefined };
        },
      }),
    });
    record.refuse = new ConnectError("no such model", Code.NotFound);
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual({
      kind: "refused",
      failure: "not-started",
      reason: "no such model",
    });
    expect(record.deletedSessions).toEqual([]);
  });
});

describe("stop-run", () => {
  it("throws a stop that fails for another reason than an ended or gone run", async () => {
    await seeded();
    const { cases } = build({
      lane: (real) => ({
        ...real,
        terminateRun: () =>
          Promise.reject(new ConnectError("engine down", Code.Unavailable)),
      }),
    });
    await expect(
      cases[STOP_RUN_ACTIVITY_NAME]("run_1", "timed out"),
    ).rejects.toThrow("engine down");
  });

  it("takes a run that already ended as stopped", async () => {
    await seeded();
    const { cases } = build({
      lane: (real) => ({
        ...real,
        terminateRun: () =>
          Promise.reject(
            new ConnectError("already ended", Code.FailedPrecondition),
          ),
      }),
    });
    await expect(
      cases[STOP_RUN_ACTIVITY_NAME]("run_1", "timed out"),
    ).resolves.toBeUndefined();
  });
});

describe("grade-try's AI-graded evidence", () => {
  it("sends the baseline check to votes and leaves a file check not graded where no file is recorded", async () => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    await completeTry(start.runId);
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      false,
    );
    expect(grade.outcomes).toEqual([
      { votes: "compare" },
      { notGraded: FILES_NOT_RECORDED_REASON },
    ]);
    expect(grade).toMatchObject({ error: "", durationSeconds: 12 });
  });

  it("leaves a file check not graded when its offloaded body cannot be read back without artifact storage", async () => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    await completeTry(
      start.runId,
      ledger({
        pathAfter: "NOTES.md",
        kind: FileChangeKind.ADD,
        after: {
          body: { case: "ref", value: { storageKey: "artifacts/notes" } },
        },
      }),
    );
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      false,
    );
    expect(grade.outcomes[NOTES]).toEqual({
      notGraded:
        "'NOTES.md' could not be read back: this install has no artifact storage",
    });
  });

  it("leaves the baseline check not graded when the archive lacks its reference transcript", async () => {
    await seeded();
    const { cases } = build({ wrap: withoutReference });
    const start = await startTry(cases);
    await completeTry(start.runId);
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      false,
    );
    expect(grade.outcomes[COMPARE]).toEqual({
      notGraded: `the baseline file '${REFERENCE_PATH}' is not in the plugin`,
    });
  });

  it.each([
    [RunPhase.RUN_TERMINATED, "the run was stopped before it finished"],
    [RunPhase.RUN_FAILED, "the run failed"],
    [RunPhase.RUN_CANCELLED, "the run was cancelled"],
    [RunPhase.RUN_IN_PROGRESS, "the run did not finish"],
  ])(
    "names a run in phase %s that carries no error as %j",
    async (phase, error) => {
      await seeded();
      const { cases } = build();
      const start = await startTry(cases);
      await setStatus(start.runId, { phase });
      const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
        CELL,
        start.runId,
        false,
      );
      expect(grade.error).toBe(error);
      expect(grade.durationSeconds).toBe(0);
    },
  );

  it("leaves every check not graded when the run stopped at its share of the eval's spending limit", async () => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    const capped =
      "Agent reached the cost limit for this message (~$3.9950 of the $4.00 budget). Send another message to continue.";
    await setStatus(start.runId, {
      phase: RunPhase.RUN_TERMINATED,
      error: capped,
      streamingUsage: { estimatedCostUsd: CELL.budgetUsd - 0.005 },
    });
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false);
    expect(TRY_SPENDING_SHARE_REASON).toBe(
      "stopped at its share of the eval's spending limit",
    );
    expect(grade.outcomes).toEqual([
      { notGraded: TRY_SPENDING_SHARE_REASON },
      { notGraded: TRY_SPENDING_SHARE_REASON },
    ]);
    expect(grade.error).toBe(capped);
    // A run the deadline stopped is graded on what it produced, as before.
    const timedOut = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, true);
    expect(timedOut.outcomes[COMPARE]).toEqual({ votes: "compare" });
    // A run the platform stopped for another reason is graded too.
    await setStatus(start.runId, { phase: RunPhase.RUN_TERMINATED, error: "stalled" });
    const stalled = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false);
    expect(stalled.outcomes[COMPARE]).toEqual({ votes: "compare" });
  });

  it("grades a run a lower cap stopped, more than a cent under the try's budget, as a stopped run", async () => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    const agentCap =
      "Agent reached the cost limit for this message (~$0.5000 of the $0.50 budget). Send another message to continue.";
    for (const spent of [0.5, CELL.budgetUsd - 0.02]) {
      await setStatus(start.runId, {
        phase: RunPhase.RUN_TERMINATED,
        error: agentCap,
        streamingUsage: { estimatedCostUsd: spent },
      });
      const grade = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false);
      expect(grade.outcomes[COMPARE], `spent ${spent}`).toEqual({ votes: "compare" });
      expect(grade.error).toBe(agentCap);
      expect(grade.costUsd).toBe(spent);
    }
  });

  it("bounds a run's own error and takes reversed stamps as no duration", async () => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    await setStatus(start.runId, {
      phase: RunPhase.RUN_FAILED,
      error: "e".repeat(700),
      startedAt: "2026-10-10T10:00:30Z",
      completedAt: "2026-10-10T10:00:00Z",
    });
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](
      CELL,
      start.runId,
      false,
    );
    expect(grade.error).toBe("e".repeat(500));
    expect(grade.durationSeconds).toBe(0);
  });
});

describe("try-spend", () => {
  it("reads the try's run by label and name, with every vote still stored", async () => {
    await seeded();
    const { cases } = build();
    const spend = createSpendActivities({ store: temp.store })[
      TRY_SPEND_ACTIVITY_NAME
    ];
    expect(await spend(EVAL_ID, CELL)).toEqual({
      sessionId: "",
      runId: "",
      costUsd: 0,
    });

    const start = await startTry(cases);
    await completeTry(start.runId);
    await setStatus(start.runId, {
      phase: RunPhase.RUN_COMPLETED,
      streamingUsage: { estimatedCostUsd: 0.3 },
    });
    const vote = await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0);
    if (vote.kind !== "started") {
      throw new Error(`the vote did not start: ${JSON.stringify(vote)}`);
    }
    await setStatus(vote.voteRunId, {
      phase: RunPhase.RUN_COMPLETED,
      streamingUsage: { estimatedCostUsd: 0.05 },
    });

    const read = await spend(EVAL_ID, CELL);
    expect(read).toMatchObject({ sessionId: start.sessionId, runId: start.runId });
    expect(read.costUsd).toBeCloseTo(0.35);
    expect(await spend(EVAL_ID, { ...CELL, tryIndex: 1 })).toMatchObject({
      runId: "",
      costUsd: 0,
    });
  });
});

describe("start-vote beside its main path", () => {
  async function completedTry(options: Parameters<typeof build>[0] = {}) {
    await seeded();
    const built = build(options);
    const start = await startTry(built.cases);
    return { ...built, start };
  }

  it("fails a vote whose try, eval or grader is gone", async () => {
    const { cases, start, record } = await completedTry();
    await completeTry(start.runId);
    const gone = { kind: "failed", reason: TRY_GONE_REASON };
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, "run_gone", COMPARE, 0),
    ).toEqual(gone);
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, 9, 0),
    ).toEqual(gone);
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](
        { ...CELL, caseIndex: 4 },
        start.runId,
        COMPARE,
        0,
      ),
    ).toEqual(gone);
    expect(record.sessions).toHaveLength(1);
  });

  it("fails a vote whose evidence is not text, with the reason the check gives", async () => {
    const { cases, start, record } = await completedTry();
    await completeTry(start.runId);
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, NOTES, 0),
    ).toEqual({ kind: "failed", reason: FILES_NOT_RECORDED_REASON });
    await completeTry(start.runId, ledger());
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, NOTES, 0),
    ).toEqual({
      kind: "failed",
      reason: "'NOTES.md' does not exist after the run",
    });
    expect(record.sessions).toHaveLength(1);
  });

  it("shows a baseline vote the reference transcript beside the run's trace", async () => {
    const { cases, start, record } = await completedTry();
    await completeTry(start.runId);
    const vote = await cases[START_VOTE_ACTIVITY_NAME](
      CELL,
      start.runId,
      COMPARE,
      0,
    );
    expect(vote.kind).toBe("started");
    const message = record.runs[1]?.run.spec?.message ?? "";
    expect(message).toContain(
      "beside the reference transcript it is compared with",
    );
    expect(message).toContain('"reference_transcript"');
    expect(message).toContain("assistant: Release notes written.");
    expect(message).toContain("PASS if the notes cover every change.");
  });

  it("fails a baseline vote when the archive lacks its reference transcript", async () => {
    const { cases, start, record } = await completedTry({
      wrap: withoutReference,
    });
    await completeTry(start.runId);
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
    ).toEqual({
      kind: "failed",
      reason: `the baseline file '${REFERENCE_PATH}' is not in the plugin`,
    });
    expect(record.sessions).toHaveLength(1);
  });

  it("fails a vote the caller seam refuses, starting no session", async () => {
    await seeded();
    const tried = build();
    const start = await startTry(tried.cases);
    await completeTry(start.runId);
    const refusing = build({
      caller: {
        mintPluginEvalCaller: () =>
          Promise.reject(new PluginEvalCallerRefusedError("the creator left")),
      },
    });
    expect(
      await refusing.cases[START_VOTE_ACTIVITY_NAME](
        CELL,
        start.runId,
        COMPARE,
        0,
      ),
    ).toEqual({ kind: "failed", reason: CANNOT_ACT_REASON });
    expect(refusing.record.sessions).toEqual([]);
    const ownReason = build({
      caller: {
        mintPluginEvalCaller: () =>
          Promise.reject(
            new PluginEvalCallerRefusedError(
              "the creator may no longer edit",
              "the eval's creator can no longer run it",
            ),
          ),
      },
    });
    expect(
      await ownReason.cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
      "a refusal naming its own reason is answered with it",
    ).toEqual({ kind: "failed", reason: "the eval's creator can no longer run it" });
    expect(refusing.lines).toEqual([
      {
        level: "warn",
        message: "the eval cannot act for anyone",
        fields: { evalId: EVAL_ID, reason: "the creator left" },
      },
    ]);
    const tryRefused = await ownReason.cases[START_TRY_ACTIVITY_NAME]({ ...CELL, tryIndex: 1 });
    expect(tryRefused).toEqual({
      kind: "refused",
      failure: "cannot-act",
      reason: "the eval's creator can no longer run it",
    });
  });

  it("answers a refused vote with out of credit or the run's own reason, deleting its session", async () => {
    const { cases, start, record } = await completedTry();
    await completeTry(start.runId);
    record.refuse = new ConnectError(
      "insufficient credits",
      Code.FailedPrecondition,
    );
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
    ).toEqual({ kind: "failed", reason: OUT_OF_CREDIT_REASON });
    record.refuse = new ConnectError(
      "the judge model is not enabled",
      Code.FailedPrecondition,
    );
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 1),
    ).toEqual({ kind: "failed", reason: "the judge model is not enabled" });
    expect(record.deletedSessions).toEqual(
      record.sessions.slice(1).map((s) => s.session.metadata?.id),
    );
    expect(record.deletedSessions).toHaveLength(2);
  });

  it("throws a vote create that fails outside the RPC contract", async () => {
    const { start } = await completedTry();
    await completeTry(start.runId);
    const failing = build({
      lane: (real) => ({
        ...real,
        createRun: () => Promise.reject(new Error("socket hang up")),
      }),
    });
    await expect(
      failing.cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
    ).rejects.toThrow("socket hang up");
  });
});

describe("read-vote beside a readable answer", () => {
  /** A stored vote run in `phase`, in session `ses_vote` unless `sessionId` is "". */
  async function storedVote(
    status: MessageInitShape<typeof RunStatusSchema>,
    sessionId = "ses_vote",
  ): Promise<string> {
    await temp.store.saveResource(
      ApiResourceKind.run,
      "run_vote",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_vote", org: ORG },
        spec:
          sessionId === ""
            ? {}
            : { target: { case: "sessionId", value: sessionId } },
        status: create(RunStatusSchema, status),
      }),
    );
    return "run_vote";
  }

  it("fails a vote run that is gone, at no cost", async () => {
    const { cases, record } = build();
    expect(await cases[READ_VOTE_ACTIVITY_NAME]("run_gone", "compare")).toEqual(
      {
        vote: { kind: "failed", reason: JUDGE_RUN_FAILED_REASON },
        costUsd: 0,
      },
    );
    expect(record.deletedSessions).toEqual([]);
  });

  it("fails a completed vote whose answer cannot be read, and says why in the log", async () => {
    const { cases, lines, record } = build();
    const id = await storedVote({
      phase: RunPhase.RUN_COMPLETED,
      structuredOutput: { compare: { result: "maybe", reason: "unsure" } },
      streamingUsage: { estimatedCostUsd: 0.02 },
    });
    expect(await cases[READ_VOTE_ACTIVITY_NAME](id, "compare")).toEqual({
      vote: { kind: "failed", reason: JUDGE_UNREADABLE_REASON },
      costUsd: 0.02,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "warn",
      message: "a vote's answer could not be read",
      fields: { voteRunId: id },
    });
    expect(record.deletedSessions).toEqual([]);
  });

  it("keeps the vote's session, so a read retried after a lost answer reads the same vote and cost", async () => {
    const { cases, record } = build();
    const id = await storedVote({
      phase: RunPhase.RUN_COMPLETED,
      structuredOutput: { compare: { result: "passed", reason: "matches" } },
      streamingUsage: { estimatedCostUsd: 0.03 },
    });
    const first = await cases[READ_VOTE_ACTIVITY_NAME](id, "compare");
    expect(first).toEqual({
      vote: { kind: "vote", passed: true, reason: "matches" },
      costUsd: 0.03,
    });
    expect(await cases[READ_VOTE_ACTIVITY_NAME](id, "compare")).toEqual(first);
    expect(record.deletedSessions).toEqual([]);
  });

  it.each([
    [RunPhase.RUN_TERMINATED, JUDGE_COST_CAP_REASON],
    [RunPhase.RUN_FAILED, JUDGE_RUN_FAILED_REASON],
    [RunPhase.RUN_CANCELLED, JUDGE_RUN_FAILED_REASON],
  ])(
    "fails a vote run that ended in phase %s as %j, without stopping it",
    async (phase, reason) => {
      const { cases, record } = build();
      const id = await storedVote({ phase });
      expect(await cases[READ_VOTE_ACTIVITY_NAME](id, "compare")).toEqual({
        vote: { kind: "failed", reason },
        costUsd: 0,
      });
      expect(record.terminated).toEqual([]);
      expect(record.deletedSessions).toEqual([]);
    },
  );
});

describe("delete-vote", () => {
  /** A stored vote run, in session `ses_vote` unless `sessionId` is "". */
  async function storedVote(sessionId = "ses_vote"): Promise<string> {
    await temp.store.saveResource(
      ApiResourceKind.run,
      "run_vote",
      RunSchema,
      create(RunSchema, {
        metadata: { id: "run_vote", org: ORG },
        spec:
          sessionId === ""
            ? {}
            : { target: { case: "sessionId", value: sessionId } },
        status: create(RunStatusSchema, { phase: RunPhase.RUN_COMPLETED }),
      }),
    );
    return "run_vote";
  }

  it("deletes the vote's session, and a retry deletes it again harmlessly", async () => {
    const { cases, record } = build();
    const id = await storedVote();
    await cases[DELETE_VOTE_ACTIVITY_NAME](id);
    await cases[DELETE_VOTE_ACTIVITY_NAME](id);
    expect(record.deletedSessions).toEqual(["ses_vote", "ses_vote"]);
  });

  it("takes a vote run gone as deleted", async () => {
    const { cases, record } = build();
    await expect(cases[DELETE_VOTE_ACTIVITY_NAME]("run_gone")).resolves.toBeUndefined();
    expect(record.deletedSessions).toEqual([]);
  });

  it("takes a session already gone as deleted, and logs one whose delete fails without throwing", async () => {
    const goneSessions = build({
      sessions: {
        delete: () =>
          Promise.reject(new ConnectError("no session", Code.NotFound)),
      },
    });
    const id = await storedVote();
    await expect(
      goneSessions.cases[DELETE_VOTE_ACTIVITY_NAME](id),
    ).resolves.toBeUndefined();
    expect(goneSessions.lines).toEqual([]);

    const brokenSessions = build({
      sessions: {
        delete: () => Promise.reject(new Error("the database is down")),
      },
    });
    await expect(
      brokenSessions.cases[DELETE_VOTE_ACTIVITY_NAME](id),
    ).resolves.toBeUndefined();
    expect(brokenSessions.lines).toEqual([
      {
        level: "error",
        message: "a plugin eval's session could not be deleted; it is left",
        fields: { sessionId: "ses_vote", reason: "the database is down" },
      },
    ]);
  });

  it("logs a non-Error delete failure by its text", async () => {
    const { cases, lines } = build({
      sessions: { delete: () => Promise.reject("refused") },
    });
    const id = await storedVote();
    await cases[DELETE_VOTE_ACTIVITY_NAME](id);
    expect(lines.map((line) => line.fields?.["reason"])).toEqual(["refused"]);
  });

  it("deletes no session for a vote run that names none", async () => {
    const { cases, record } = build();
    const id = await storedVote("");
    await cases[DELETE_VOTE_ACTIVITY_NAME](id);
    expect(record.deletedSessions).toEqual([]);
  });
});

describe("grade-try over a plugin's MCP server", () => {
  it("names an MCP call by the server's name as the plugin declares it, so a grader written against Claude Code's name passes", async () => {
    await seeded();
    // The plugin's `My_Server` installs under the slug `myserver`.
    await temp.store.saveResource(
      ApiResourceKind.mcp_server,
      "mcp_2",
      McpServerSchema,
      create(McpServerSchema, {
        metadata: {
          id: "mcp_2",
          org: ORG,
          slug: "myserver",
          name: "My_Server",
          labels: { [PLUGIN_LABEL]: PLUGIN_ID },
        },
      }),
    );
    const { cases } = build({
      suite: {
        "evals/mcp-case/prompt.md": "Find the bug.\n",
        "evals/mcp-case/graders/searched.md":
          "---\ntype: tool_used\ntool: mcp__plugin_thermos_My_Server__search\n---\n",
      },
    });
    const start = await startTry(cases);
    await setStatus(start.runId, {
      phase: RunPhase.RUN_COMPLETED,
      messages: [
        {
          type: MessageType.MESSAGE_AI,
          content: "",
          toolCalls: [
            { id: "c1", name: "search", mcpServerSlug: "myserver", args: { q: "bug" } },
          ],
        },
        { type: MessageType.MESSAGE_AI, content: "Found it." },
      ],
    });
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false);
    expect(grade.outcomes).toEqual([
      {
        passed: true,
        reason: "1 call(s) to 'mcp__plugin_thermos_My_Server__search' (step 1); expected at least 1",
      },
    ]);
  });
});

describe("record-score beside a graded try", () => {
  const PASSED: TryGrade = {
    outcomes: [{ passed: true, reason: "covers every change" }],
    error: "",
    costUsd: 0.3,
    durationSeconds: 12,
  };

  it("leaves the try not graded when its eval is gone", async () => {
    const { cases } = build();
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](
      CELL,
      { sessionId: "ses_1", runId: "run_2" },
      PASSED,
      [],
    );
    expect(result).toEqual({
      sessionId: "ses_1",
      runId: "run_2",
      error: "",
      costUsd: 0.3,
      durationSeconds: 12,
      state: "not-graded",
      score: 0,
      notGradedReason: TRY_GONE_REASON,
      outOfCredit: false,
    });
  });

  it("leaves a grader the grade has no outcome for not graded, and writes that Score", async () => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    await completeTry(start.runId);
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](
      CELL,
      start,
      PASSED,
      [[], []],
    );
    expect(result).toMatchObject({
      state: "not-graded",
      notGradedReason: TRY_GONE_REASON,
      outOfCredit: false,
    });
    const scores = (
      await listRunScores(temp.store, capturingLogger().logger, start.runId)
    ).filter((score) => score.spec?.source === ScoreSource.eval);
    expect(scores).toHaveLength(1);
    expect(scores[0]?.status?.notGradedReason).toBe(TRY_GONE_REASON);
  });

  it("keeps the score on the eval only while the try's run has not ended", async () => {
    await seeded();
    const { cases, lines } = build();
    const start = await startTry(cases);
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](
      CELL,
      start,
      {
        ...PASSED,
        outcomes: [
          { passed: true, reason: "covers every change" },
          { passed: false, reason: "no rename listed" },
        ],
      },
      [[], []],
    );
    expect(result).toMatchObject({ state: "graded" });
    expect(
      await listRunScores(temp.store, capturingLogger().logger, start.runId),
    ).toEqual([]);
    expect(lines).toEqual([
      {
        level: "warn",
        message:
          "a try's run has not ended; its score is kept on the eval only",
        fields: { runId: start.runId },
      },
    ]);
  });
});
