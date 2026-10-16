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
 *     first attempt too, and before the caller is minted, so a refused
 *     mint adopts it all the same; the attempt read from the activity
 *     context; a plugin moved past the eval's version (no try starts); a
 *     create that fails outside the RPC contract, an RPC code
 *     no refusal covers, an empty and an over-long refusal; a refused run
 *     whose session has no id;
 *   - stop-run: a failure other than "already ended or gone" is thrown; a
 *     refused stop is read against the run's phase, an ended or gone run
 *     stopped, a paused or approval-waiting one thrown as not stopped;
 *   - grade-try: an MCP call named by the server segment the turn gave
 *     it, and a read of a plugin skill's SKILL.md named `Skill` by the
 *     name the plugin's status lists for its path, so graders written
 *     against Claude Code's names pass; the evidence an AI-graded check
 *     cannot be shown (no file record, an offloaded file and no artifact
 *     storage, a reference transcript the archive lacks); the run's error named per phase when
 *     the run carries none; the duration with missing or reversed stamps;
 *     a run its own cap stopped at the try's budget leaves every check not
 *     graded, where the deadline's stop, a lower cap's stop and the
 *     platform's other stops are graded; a run its case stopped (a failed
 *     scaffold, a mock's abort) asks no votes and is recorded as a 0 with
 *     the scaffold's error or the abort, its score failing with every
 *     grader not checked;
 *   - start-vote: a try, eval or grader gone; evidence that is not text;
 *     the reference transcript in the vote's message, or missing; a caller
 *     the seam refuses; a refused create (the run's own reason, a keyless
 *     organization's FAILED_PRECONDITION copy among them; a failure outside
 *     the RPC contract);
 *   - read-vote: a vote run gone; an answer that cannot be read; each
 *     ended phase; its session kept, so a read retried after a lost answer
 *     reads the same vote and cost;
 *   - delete-vote: the vote's session deleted, once and again; a vote run
 *     gone; a session already gone as deleted, one whose delete fails
 *     thrown for the activity's retries, a vote with no session; a refused
 *     run's session delete, by contrast, logged and never thrown;
 *   - try-spend: no run found is no spend; the try's run found by label
 *     and name, its cost and its stored votes' added;
 *   - record-score: an eval gone; a grader the grade has no outcome for;
 *     a run that has not ended keeps its score on the eval only;
 *   - an Eval's case on its agent: the try's case context names the
 *     Eval's archive and mocks the agent's own server; its grade reads the
 *     plugins the run loaded by digest, once each, one of them gone and
 *     one stamped with no version.
 *
 * The suite here is one case with the two AI-graded types: a `baseline`
 * check over a reference transcript and an `llm` check over one file.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject, MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { MockActivityEnvironment } from "@temporalio/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { inMemoryPluginFiles } from "@stigmer/plugin-package";
import { EvalSchema } from "@stigmer/apis/ai/stigmer/agentic/eval/v1/api_pb";
import { EvalRunSchema as EvalRunRowSchema } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginSkillSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  FileChangeKind,
  RunPhase,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { CapturedFileChangeSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import {
  CriterionResult,
  ScoreSource,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { LogFields, Logger } from "../../../boot/logger.js";
import { EVAL_RUN_LABEL } from "../../../domain/eval-run/constants.js";
import { capturedSet } from "../../../domain/run/__tests__/file-review-seed.js";
import { newPatternPool } from "../../../domain/eval-run/graders/patterns.js";
import { tryRunName } from "../../../domain/eval-run/try-run.js";
import { FILES_NOT_RECORDED_REASON } from "../../../domain/eval-run/graders/verdict.js";
import {
  JUDGE_COST_CAP_REASON,
  JUDGE_NOT_FINISHED_REASON,
  JUDGE_RUN_FAILED_REASON,
  JUDGE_UNREADABLE_REASON,
} from "../../../domain/score/constants.js";
import type { JudgeSessionDeleter } from "../../../domain/score/ports.js";
import { listRunScores } from "../../../domain/score/queries.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { EvalRunCallerMint } from "../../../extensions/eval-run-caller.js";
import { EvalRunCallerRefusedError } from "../../../extensions/eval-run-caller.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import {
  INDICATOR_NOT_JUDGED_WITHOUT_PLUGIN_REASON,
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
  EVAL_RUN_BUSY_FAILURE_TYPE,
  PLUGIN_UPDATED_REASON,
  READ_VOTE_ACTIVITY_NAME,
  RECORD_SCORE_ACTIVITY_NAME,
  START_TRY_ACTIVITY_NAME,
  START_VOTE_ACTIVITY_NAME,
  STOP_RUN_ACTIVITY_NAME,
  TRY_MIN_BUDGET_USD,
  TRY_NOT_STARTED_REASON,
  TRY_SPENDING_SHARE_REASON,
  TRY_SPEND_ACTIVITY_NAME,
} from "../names.js";
import type { CaseInput, TryGrade } from "../names.js";
import type { EvalRunTryLane } from "../ports.js";
import {
  AGENT_HASH,
  AGENT_ID,
  DIGEST,
  EVAL_ID,
  ORG,
  PLUGIN_ID,
  appendTurnEvents,
  catalog,
  lane,
  scoreChain,
  seedAgent,
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

/** Admission's refusal of a run whose organization has no key for its model. */
const KEYLESS_COPY =
  "This organization has no Anthropic key for model 'claude-sonnet-4-5', so the run was not started. An admin can add one in Settings → Provider keys.";

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
    readonly caller?: EvalRunCallerMint | "none";
    readonly wrap?: (real: EvalContextLoader) => EvalContextLoader;
    readonly lane?: (real: EvalRunTryLane) => EvalRunTryLane;
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
  const mint: EvalRunCallerMint = {
    async mintEvalRunCaller(_org, evalId) {
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
    evalRunCaller:
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
    evalRunCaller: undefined,
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

/** A completed try with a final message and, when given, its file record. */
async function completeTry(
  runId: string,
  sets?: FileChangeSet[],
): Promise<void> {
  await appendTurnEvents(temp.store, runId, (turn) =>
    turn.user("Write the release notes.").turnMessage("Release notes written."),
  );
  await setStatus(runId, {
    phase: RunPhase.RUN_COMPLETED,
    startedAt: "2026-10-10T10:00:00Z",
    completedAt: "2026-10-10T10:00:12Z",
    ...(sets === undefined ? {} : { fileChanges: sets }),
  });
}

/** A file record holding one change set: its baseline alone, or captured with `changes`. */
function ledger(
  ...changes: MessageInitShape<typeof CapturedFileChangeSchema>[]
): FileChangeSet[] {
  return [
    capturedSet(
      "t1",
      changes.map((change) => create(CapturedFileChangeSchema, change)),
      changes.length > 0,
    ),
  ];
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
    const files = inMemoryPluginFiles(new Map(kept));
    return { ...context, sources: context.sources.map((source) => ({ ...source, files })) };
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
        mintEvalRunCaller: () =>
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
        if (context === undefined) return context;
        const evalRun = { ...context.evalRun, spec: undefined };
        return { ...context, evalRun };
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
        // The plugin's head moves after the eval run planned its tries.
        const head = await temp.store.getResource(ApiResourceKind.plugin, PLUGIN_ID, PluginSchema);
        head.status!.digest = "b".repeat(64);
        await temp.store.saveResource(ApiResourceKind.plugin, PLUGIN_ID, PluginSchema, head);
        return context;
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

  it("adopts an earlier attempt's run before it mints the caller, so a refused mint never leaves that run going", async () => {
    await seeded();
    const first = build();
    const started = await first.cases[START_TRY_ACTIVITY_NAME](CELL);
    expect(started.kind).toBe("started");
    const refusing = build({
      attempt: () => 2,
      caller: {
        mintEvalRunCaller: () =>
          Promise.reject(new EvalRunCallerRefusedError("the creator left")),
      },
    });
    expect(await refusing.cases[START_TRY_ACTIVITY_NAME](CELL)).toEqual(started);
    expect(refusing.record.runs).toEqual([]);
    expect(refusing.record.sessions).toEqual([]);
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

  it("takes a refused run's session already gone as deleted, and logs nothing", async () => {
    await seeded();
    const { cases, record, lines } = build({
      sessions: {
        delete: async () => {
          throw new ConnectError("no such session", Code.NotFound);
        },
      },
    });
    record.refuse = new ConnectError("no such model", Code.NotFound);
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toMatchObject({ kind: "refused" });
    expect(lines.filter((l) => l.level === "error")).toEqual([]);
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

describe("start-try's refused session", () => {
  it("answers a refused session create as the run's refusal, so it is not retried for capacity", async () => {
    await seeded();
    const refusing = (error: Error) =>
      build({
        lane: (real) => ({
          ...real,
          createSession: () => Promise.reject(error),
        }),
      }).cases;
    expect(
      await refusing(
        new ConnectError("agent 'thermos' not found", Code.NotFound),
      )[START_TRY_ACTIVITY_NAME](CELL),
    ).toEqual({
      kind: "refused",
      failure: "not-started",
      reason: "agent 'thermos' not found",
    });
    expect(
      await refusing(
        new ConnectError(KEYLESS_COPY, Code.FailedPrecondition),
      )[START_TRY_ACTIVITY_NAME](CELL),
    ).toEqual({
      kind: "refused",
      failure: "not-started",
      reason: KEYLESS_COPY,
    });
    await expect(
      refusing(new ConnectError("full", Code.ResourceExhausted))[
        START_TRY_ACTIVITY_NAME
      ](CELL),
    ).rejects.toMatchObject({ type: EVAL_RUN_BUSY_FAILURE_TYPE });
    await expect(
      refusing(new Error("the store is down"))[START_TRY_ACTIVITY_NAME](CELL),
    ).rejects.toThrow("the store is down");
  });
});

describe("start-try beside a raced retry", () => {
  /** A run row of the try, as a start attempt left it, created at `createdAtMs`. */
  async function storedTryRun(id: string, createdAtMs: number): Promise<void> {
    await temp.store.saveResource(
      ApiResourceKind.run,
      id,
      RunSchema,
      create(RunSchema, {
        metadata: {
          id,
          org: ORG,
          name: tryRunName(EVAL_ID, CELL),
          labels: { [EVAL_RUN_LABEL]: EVAL_ID },
        },
        status: {
          phase: RunPhase.RUN_IN_PROGRESS,
          streamingUsage: { estimatedCostUsd: createdAtMs / 1000 },
          audit: { specAudit: { createdAt: timestampFromMs(createdAtMs) } },
        },
      }),
    );
  }

  it("adopts the earliest created of two runs under the try's name, stops the other, and reads that one's spend", async () => {
    await seeded();
    await storedTryRun("run_b", 2_000);
    await storedTryRun("run_a", 3_000);
    await storedTryRun("run_c", 2_000);
    const { cases, record } = build();
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toMatchObject({
      kind: "started",
      runId: "run_b",
    });
    // A tie on the stamp is broken by the id.
    expect(record.terminated.sort()).toEqual(["run_a", "run_c"]);
    expect(record.runs).toEqual([]);
    const spend = createSpendActivities({ store: temp.store })[
      TRY_SPEND_ACTIVITY_NAME
    ];
    expect(await spend(EVAL_ID, CELL)).toMatchObject({
      runId: "run_b",
      costUsd: 2,
    });
  });

  it("finds the try's run through the run list index, never scanning the run kind", async () => {
    await seeded();
    await storedTryRun("run_b", 2_000);
    const scans = [
      vi.spyOn(temp.store, "findAllByLabel"),
      vi.spyOn(temp.store, "listResources"),
    ];
    const { cases } = build();
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toMatchObject({
      kind: "started",
      runId: "run_b",
    });
    const spend = createSpendActivities({ store: temp.store })[
      TRY_SPEND_ACTIVITY_NAME
    ];
    expect(await spend(EVAL_ID, CELL)).toMatchObject({ runId: "run_b" });
    // The kinds each scan was asked for: the run kind is never one.
    for (const scan of scans) {
      expect(scan.mock.calls.map((call) => call[0])).not.toContain(
        ApiResourceKind.run,
      );
    }
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

  it("throws a stop that fails outside the RPC contract", async () => {
    await seeded();
    const { cases } = build({
      lane: (real) => ({
        ...real,
        terminateRun: () => Promise.reject(new Error("socket hang up")),
      }),
    });
    await expect(
      cases[STOP_RUN_ACTIVITY_NAME]("run_1", "timed out"),
    ).rejects.toThrow("socket hang up");
  });

  /** Activities whose stop the run's lifecycle refuses as it refuses an ended, paused or approval-waiting run. */
  function refusingStops() {
    return build({
      lane: (real) => ({
        ...real,
        terminateRun: () =>
          Promise.reject(
            new ConnectError("the run cannot be stopped in its phase", Code.FailedPrecondition),
          ),
      }),
    });
  }

  it("takes a refused stop of a run that already ended, or is gone, as stopped", async () => {
    await seeded();
    const { cases } = refusingStops();
    const start = await startTry(cases);
    await completeTry(start.runId);
    await expect(
      cases[STOP_RUN_ACTIVITY_NAME](start.runId, "timed out"),
    ).resolves.toBeUndefined();
    await expect(
      cases[STOP_RUN_ACTIVITY_NAME]("run_gone", "timed out"),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["paused", RunPhase.RUN_PAUSED],
    ["waiting for approval", RunPhase.RUN_WAITING_FOR_APPROVAL],
  ])(
    "throws a refused stop of a run %s: it is not stopped",
    async (_, phase) => {
      await seeded();
      const { cases } = refusingStops();
      const start = await startTry(cases);
      await setStatus(start.runId, { phase });
      await expect(
        cases[STOP_RUN_ACTIVITY_NAME](start.runId, "the eval was cancelled"),
      ).rejects.toMatchObject({ code: Code.FailedPrecondition });
    },
  );
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

  it("reads a cost-limit stop at the floor budget as the eval's share only once the run's cost reached that budget", async () => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    const floor = { ...CELL, budgetUsd: TRY_MIN_BUDGET_USD };
    const capped =
      "Agent reached the cost limit for this message (~$0.0040 of the $0.004 budget). Send another message to continue.";
    // The agent's own lower cap stopped it under the floor: graded as a stopped run.
    await setStatus(start.runId, {
      phase: RunPhase.RUN_TERMINATED,
      error: capped,
      streamingUsage: { estimatedCostUsd: 0.004 },
    });
    expect(
      (await cases[GRADE_TRY_ACTIVITY_NAME](floor, start.runId, false)).outcomes[COMPARE],
    ).toEqual({ votes: "compare" });
    // At the floor itself: the eval's share stopped it.
    await setStatus(start.runId, {
      phase: RunPhase.RUN_TERMINATED,
      error: capped,
      streamingUsage: { estimatedCostUsd: TRY_MIN_BUDGET_USD },
    });
    expect(
      (await cases[GRADE_TRY_ACTIVITY_NAME](floor, start.runId, false)).outcomes[COMPARE],
    ).toEqual({ notGraded: TRY_SPENDING_SHARE_REASON });
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

  it("fails a vote whose session create is refused, with the refusal's reason, and rethrows any other failure", async () => {
    let refusal: Error = new ConnectError(KEYLESS_COPY, Code.FailedPrecondition);
    let sessions = 0;
    // The try's own session is created; every vote's is refused.
    const { cases, start } = await completedTry({
      lane: (real) => ({
        ...real,
        createSession: (session, caller) =>
          ++sessions === 1
            ? real.createSession(session, caller)
            : Promise.reject(refusal),
      }),
    });
    await completeTry(start.runId);
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
    ).toEqual({ kind: "failed", reason: KEYLESS_COPY });
    refusal = new ConnectError("judge model withdrawn", Code.InvalidArgument);
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
    ).toEqual({ kind: "failed", reason: "judge model withdrawn" });
    refusal = new Error("the store is down");
    await expect(
      cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
    ).rejects.toThrow("the store is down");
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
        mintEvalRunCaller: () =>
          Promise.reject(new EvalRunCallerRefusedError("the creator left")),
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
        mintEvalRunCaller: () =>
          Promise.reject(
            new EvalRunCallerRefusedError(
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

  it("answers a refused vote with the run's own reason, deleting its session", async () => {
    const { cases, start, record } = await completedTry();
    await completeTry(start.runId);
    record.refuse = new ConnectError(KEYLESS_COPY, Code.FailedPrecondition);
    expect(
      await cases[START_VOTE_ACTIVITY_NAME](CELL, start.runId, COMPARE, 0),
    ).toEqual({ kind: "failed", reason: KEYLESS_COPY });
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
  /** A stored vote run; its answer, when given, in its session's events. */
  async function storedVote(
    status: MessageInitShape<typeof RunStatusSchema>,
    answer?: JsonObject,
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
    if (answer !== undefined) {
      await appendTurnEvents(temp.store, "run_vote", (turn) => turn.structuredOutput(answer));
    }
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
    const id = await storedVote(
      { phase: RunPhase.RUN_COMPLETED, streamingUsage: { estimatedCostUsd: 0.02 } },
      { compare: { result: "maybe", reason: "unsure" } },
    );
    expect(await cases[READ_VOTE_ACTIVITY_NAME](id, "compare")).toEqual({
      vote: { kind: "failed", reason: JUDGE_UNREADABLE_REASON },
      costUsd: 0.02,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: "warn",
      message: "a vote's answer could not be read",
      fields: { voteRunId: id, answer: 'keys ["result","reason"]; result "maybe"; reason a string of 6 characters' },
    });
    expect(record.deletedSessions).toEqual([]);
  });

  it("keeps the vote's session, so a read retried after a lost answer reads the same vote and cost", async () => {
    const { cases, record } = build();
    const id = await storedVote(
      { phase: RunPhase.RUN_COMPLETED, streamingUsage: { estimatedCostUsd: 0.03 } },
      { compare: { result: "passed", reason: "matches" } },
    );
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

  it("takes a session already gone as deleted, and throws one whose delete fails, for the activity's retries", async () => {
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
    ).rejects.toThrow("the database is down");
    const refused = build({
      sessions: {
        delete: () =>
          Promise.reject(new ConnectError("refused", Code.PermissionDenied)),
      },
    });
    await expect(
      refused.cases[DELETE_VOTE_ACTIVITY_NAME](id),
    ).rejects.toMatchObject({ code: Code.PermissionDenied });
  });

  it("logs a non-Error delete failure by its text", async () => {
    // A refused run's session is deleted on a best effort: its failure is
    // logged, where a vote's delete throws.
    const { cases, lines } = build({
      sessions: { delete: () => Promise.reject("refused") },
      lane: (real) => ({
        ...real,
        createRun: () =>
          Promise.reject(new ConnectError("no such model", Code.InvalidArgument)),
      }),
    });
    await seeded();
    expect(await cases[START_TRY_ACTIVITY_NAME](CELL)).toMatchObject({
      kind: "refused",
    });
    expect(lines.map((line) => line.fields?.["reason"])).toContain("refused");
  });

  it("deletes no session for a vote run that names none", async () => {
    const { cases, record } = build();
    const id = await storedVote("");
    await cases[DELETE_VOTE_ACTIVITY_NAME](id);
    expect(record.deletedSessions).toEqual([]);
  });
});

describe("a try its case stopped", () => {
  it.each([
    [
      "a failed scaffold",
      "The eval case's scaffold failed: exit 2: git: not found",
      { kind: "scaffold-failed", detail: "exit 2: git: not found" },
      { error: "scaffold failed: exit 2: git: not found" },
      "not checked: the scaffold failed",
    ],
    [
      "a mock's abort",
      'A mock stopped the run: server "tracker", tool "create_issue": input.title must be a string',
      { kind: "mock-aborted", server: "tracker", tool: "create_issue", reason: "input.title must be a string" },
      { error: "", aborted: { server: "tracker", tool: "create_issue", reason: "input.title must be a string" } },
      "not checked: aborted by tracker.create_issue",
    ],
  ])("asks no votes after %s, and records the try as a 0", async (_name, error, stopped, recorded, why) => {
    await seeded();
    const { cases } = build();
    const start = await startTry(cases);
    await setStatus(start.runId, {
      phase: RunPhase.RUN_TERMINATED,
      error,
      streamingUsage: { estimatedCostUsd: 0.2 },
    });
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false);
    expect(grade.stopped).toEqual(stopped);
    expect(grade.outcomes.every((outcome) => !("votes" in outcome))).toBe(true);
    expect(grade.costUsd).toBe(0.2);
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](CELL, start, grade, grade.outcomes.map(() => []));
    expect(result).toMatchObject({ state: "graded", score: 0, notGradedReason: "", ...recorded });
    const [score] = (
      await listRunScores(temp.store, capturingLogger().logger, start.runId)
    ).filter((written) => written.spec?.source === ScoreSource.eval);
    expect(score?.spec?.value).toEqual({ case: "passed", value: false });
    expect(score?.spec?.criteria.map((c) => [c.result, c.reason])).toEqual(
      grade.outcomes.map(() => [CriterionResult.not_applicable, why]),
    );
  });
});

describe("grade-try over a plugin's MCP server and skills", () => {
  it("names an MCP call by the server segment the turn gave it, so a grader written against Claude Code's name passes", async () => {
    await seeded();
    const { cases } = build({
      suite: {
        "evals/mcp-case/prompt.md": "Find the bug.\n",
        "evals/mcp-case/graders/searched.md":
          "---\ntype: tool_used\ntool: mcp__plugin_thermos_My_Server__search\n---\n",
      },
    });
    const start = await startTry(cases);
    await setStatus(start.runId, { phase: RunPhase.RUN_COMPLETED });
    await appendTurnEvents(temp.store, start.runId, (turn) =>
      turn
        .turnMessage("", [
          { id: "c1", name: "search", mcpServer: "plugin_thermos_My_Server", input: { q: "bug" } },
        ])
        .turnMessage("Found it."),
    );
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false);
    expect(grade.outcomes).toEqual([
      {
        passed: true,
        reason: "1 call(s) to 'mcp__plugin_thermos_My_Server__search' (step 1); expected at least 1",
      },
    ]);
  });

  it("names a read of a plugin skill's SKILL.md as Skill, by the name the plugin's status lists for its path", async () => {
    await seeded();
    // The skill's directory is not its name: only the plugin's list says
    // `skills/write-commit` is `commit-message`.
    await temp.store.updateResource(
      ApiResourceKind.plugin,
      PLUGIN_ID,
      PluginSchema,
      (live) => {
        live.status!.skills = [
          create(PluginSkillSchema, {
            name: "commit-message",
            path: "skills/write-commit",
          }),
        ];
      },
    );
    const { cases } = build({
      suite: {
        "evals/skill-case/prompt.md": "Write the commit message.\n",
        "evals/skill-case/graders/fired.md":
          '---\ntype: tool_used\ntool: Skill\ninput_match: \'"skill"\\s*:\\s*"thermos:commit-message"\'\n---\n',
      },
    });
    const start = await startTry(cases);
    await setStatus(start.runId, { phase: RunPhase.RUN_COMPLETED });
    await appendTurnEvents(temp.store, start.runId, (turn) =>
      turn
        .turnMessage("", [
          {
            id: "c1",
            name: "read_file",
            input: { file_path: `/work/.stigmer/plugins/${DIGEST}/skills/write-commit/SKILL.md` },
          },
        ])
        .turnMessage("fix: rename fetchUser"),
    );
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](CELL, start.runId, false);
    expect(grade.outcomes).toEqual([
      {
        passed: true,
        reason: "1 call(s) to 'Skill' with matching input (step 1); expected at least 1",
      },
    ]);
  });
});

describe("an AI-graded indicator", () => {
  /** The judged case's baseline check, scored, beside an llm check marked `arm: with-only`, an indicator. */
  const INDICATOR_SUITE: Readonly<Record<string, string>> = {
    [`${CASE_DIR}/prompt.md`]: JUDGED_SUITE[`${CASE_DIR}/prompt.md`]!,
    [REFERENCE_PATH]: JUDGED_SUITE[REFERENCE_PATH]!,
    [`${CASE_DIR}/graders/compare.md`]: JUDGED_SUITE[`${CASE_DIR}/graders/compare.md`]!,
    [`${CASE_DIR}/graders/style.md`]:
      "---\ntype: llm\narm: with-only\n---\n\nPASS if the reply is short.\n",
  };
  const WITHOUT: CaseInput = { ...CELL, arm: "without" };

  it("casts no votes in the without-plugin arm, and its votes in the with-plugin arm", async () => {
    await seeded();
    const { cases } = build({ suite: INDICATOR_SUITE });
    const without = await cases[START_TRY_ACTIVITY_NAME](WITHOUT);
    const withPlugin = await startTry(cases);
    if (without.kind !== "started") throw new Error("the without-plugin try did not start");
    await completeTry(without.runId);
    await completeTry(withPlugin.runId);
    expect(
      (await cases[GRADE_TRY_ACTIVITY_NAME](WITHOUT, without.runId, false)).outcomes,
    ).toEqual([
      { votes: "compare" },
      { notGraded: INDICATOR_NOT_JUDGED_WITHOUT_PLUGIN_REASON },
    ]);
    expect(
      (await cases[GRADE_TRY_ACTIVITY_NAME](CELL, withPlugin.runId, false)).outcomes,
    ).toEqual([{ votes: "compare" }, { votes: "style" }]);
  });

  it("left not graded, is reported on its criterion and does not void the try", async () => {
    await seeded();
    const { cases } = build({ suite: INDICATOR_SUITE });
    const start = await startTry(cases);
    await completeTry(start.runId);
    const passing = { kind: "vote", passed: true, reason: "covers every change" } as const;
    const failed = { kind: "failed", reason: JUDGE_RUN_FAILED_REASON } as const;
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](
      CELL,
      start,
      {
        outcomes: [{ votes: "compare" }, { votes: "style" }],
        error: "",
        costUsd: 0.3,
        durationSeconds: 12,
      },
      [
        [passing, passing, passing],
        [failed, failed, failed],
      ],
    );
    expect(result).toMatchObject({ state: "graded", score: 1, notGradedReason: "" });
    const [score] = (
      await listRunScores(temp.store, capturingLogger().logger, start.runId)
    ).filter((written) => written.spec?.source === ScoreSource.eval);
    expect(score?.spec?.value).toEqual({ case: "passed", value: true });
    expect(score?.spec?.criteria.map((c) => [c.result, c.reason])).toEqual([
      [CriterionResult.passed, "3 of 3 votes passed: covers every change"],
      [CriterionResult.not_applicable, `indicator only; not graded: ${JUDGE_RUN_FAILED_REASON}`],
    ]);
  });

  it("left not graded in the without-plugin arm, leaves that try graded on its scored check", async () => {
    await seeded();
    const { cases } = build({ suite: INDICATOR_SUITE });
    const without = await cases[START_TRY_ACTIVITY_NAME](WITHOUT);
    if (without.kind !== "started") throw new Error("the without-plugin try did not start");
    await completeTry(without.runId);
    const failing = { kind: "vote", passed: false, reason: "misses the rename" } as const;
    const result = await cases[RECORD_SCORE_ACTIVITY_NAME](
      WITHOUT,
      without,
      {
        outcomes: [
          { votes: "compare" },
          { notGraded: INDICATOR_NOT_JUDGED_WITHOUT_PLUGIN_REASON },
        ],
        error: "",
        costUsd: 0.1,
        durationSeconds: 12,
      },
      [[failing, failing, failing], []],
    );
    expect(result).toMatchObject({ state: "graded", score: 0 });
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

describe("an Eval's case on its agent", () => {
  const EVAL_RUN = "evr_on_eval";

  /** The judged case at the archive's root, with a mock for the agent's own server. */
  const EVAL_FOLDER: Readonly<Record<string, string>> = {
    ...Object.fromEntries(Object.entries(JUDGED_SUITE).map(([path, content]) => [path.slice("evals/".length), content])),
    "mocks/billing/charge.md": "Charged.",
  };

  async function seedEvalSource(): Promise<void> {
    await seedAgent(temp.store, { mcpServers: [{ name: "billing", url: "https://billing.example.com/mcp" }] });
    await seedPlugin(temp.store);
    await temp.store.saveResource(
      ApiResourceKind.eval,
      "evs_1",
      EvalSchema,
      create(EvalSchema, { metadata: { id: "evs_1", org: ORG, slug: "support", name: "support" }, status: { digest: DIGEST } }),
    );
    await temp.store.saveResource(
      ApiResourceKind.eval_run,
      EVAL_RUN,
      EvalRunRowSchema,
      create(EvalRunRowSchema, {
        metadata: { id: EVAL_RUN, org: ORG, name: EVAL_RUN },
        spec: { subject: { case: "agentId", value: AGENT_ID }, agentVersion: AGENT_HASH, runs: 1, maxCostUsd: 5 },
        status: {
          plugins: [{ pluginId: PLUGIN_ID, pluginSlug: "thermos", pluginDigest: DIGEST, attached: true, notRunReason: "not selected" }],
          evals: [{ evalId: "evs_1", evalSlug: "support", evalDigest: DIGEST }],
        },
      }),
    );
  }

  it("starts a try naming the Eval's archive, and grades it naming each skill read by the plugin the try loaded", async () => {
    await seedEvalSource();
    const { cases, record } = build({ suite: EVAL_FOLDER });
    const cell = { ...CELL, evalId: EVAL_RUN };
    const start = await cases[START_TRY_ACTIVITY_NAME](cell);
    if (start.kind !== "started") {
      throw new Error(`the try did not start: ${JSON.stringify(start)}`);
    }
    const run = record.runs[0]?.run;
    const caseContext = run?.spec?.evalCase;
    expect([caseContext?.evalId, caseContext?.evalDigest, caseContext?.pluginId, caseContext?.suiteDir]).toEqual(["evs_1", DIGEST, "", ""]);
    expect(caseContext?.mocks.map((mock) => [mock.server, mock.home.case])).toEqual([["billing", "agent"]]);

    await completeTry(start.runId);
    await temp.store.updateResource(ApiResourceKind.run, start.runId, RunSchema, (live) => {
      live.status!.loadedVersions = {
        $typeName: "ai.stigmer.agentic.run.v1.LoadedVersions",
        skills: [],
        plugins: [
          { $typeName: "ai.stigmer.commons.apiresource.ApiResourceReference", org: ORG, kind: ApiResourceKind.plugin, id: PLUGIN_ID, slug: "", version: DIGEST },
          { $typeName: "ai.stigmer.commons.apiresource.ApiResourceReference", org: ORG, kind: ApiResourceKind.plugin, id: "plg_gone", slug: "", version: "c".repeat(64) },
          // The same version again, and one stamped with no version: each read once, or not at all.
          { $typeName: "ai.stigmer.commons.apiresource.ApiResourceReference", org: ORG, kind: ApiResourceKind.plugin, id: PLUGIN_ID, slug: "", version: DIGEST },
          { $typeName: "ai.stigmer.commons.apiresource.ApiResourceReference", org: ORG, kind: ApiResourceKind.plugin, id: PLUGIN_ID, slug: "", version: "" },
        ],
      };
    });
    const grade = await cases[GRADE_TRY_ACTIVITY_NAME](cell, start.runId, false);
    expect(grade.error).toBe("");
  });
});

