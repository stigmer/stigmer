/**
 * Invoke-workflow orchestration tests — ports the scenario matrix of
 * pkg/domain/agentexecution/temporal/workflows/invoke_workflow_pause_test.go
 * (TestWorkflowEnvironment with mocked activities and a persisted-status
 * recorder).
 *
 * What these pin (all load-bearing orchestration contracts):
 *   - the happy path (EnsureThread → ExecuteDeepAgent → EC cleanup), and
 *     the same run from an input that still carries the retired
 *     `callback_token` and `parent_workflow_id` keys (an older server's
 *     dispatch): the keys are ignored and it runs as an ordinary run,
 *     its own history recording no signal or cancel to another workflow
 *     and no activity beyond an ordinary run's;
 *   - the HITL loop (WAITING persist → gate re-read → approvalGateResolved
 *     → re-invoke with TurnSeq = approvalCycle — the deterministic
 *     change-set id input); a new run reads its gate as the count of the
 *     turn's open asks in its session's log (CountOpenGates, with the run
 *     and its session) and never loads the run for it, and a count that
 *     cannot be read waits for the signal;
 *   - the zero-gate fail-fast bound (MAX_ZERO_GATE_CYCLES): file review
 *     never holds a turn, so a gate with no pending approval is empty
 *     whatever its change sets say (stigmer#1471);
 *   - a message turn closes the previous turn's file review first
 *     (CloseFileReview, with the run and its session, before the runner),
 *     and a failing close never fails the turn; a reconcile turn
 *     (`reconcile_file_review`) closes nothing and titles no session;
 *   - pause/resume (activity cancelled, PAUSED persisted, resume
 *     re-invokes) — Go's CancellationScope pattern;
 *   - bounded auto-recovery on worker-shutdown shapes (#776: IN_PROGRESS
 *     persisted, honest status copy on exhaustion);
 *   - RUN_FAILED propagation with the fallback persist;
 *   - each stop and failure write says the stop's cause and no transcript
 *     line: the pause persist and the cancellation `user`, a broken flow
 *     `failed` with its wrapped error, a runner-reported failure none of
 *     its own (the runner's write states it);
 *   - external cancellation cleanup (CANCELLED persisted quietly —
 *     stigmer#282);
 *   - a new run records the values-fetched patch and never calls the
 *     retired run-end cleanup, on any exit;
 *   - the cursor flow's harness_state_id re-read discipline;
 *   - every end of the workflow (completed, failed by the runner, broken,
 *     cancelled) calls StartQueuedTurn with the run's session as its last
 *     act; a run in no session calls nothing; a StartQueuedTurn that fails
 *     changes nothing about how the workflow ends;
 *   - the run credential handed on (2026-09-16): the workflow input's
 *     `execution_context_token` reaches EVERY Execute* invocation, first
 *     turn and re-invocation, both harnesses, and the key is absent when
 *     the dispatch carried none.
 *
 * Recorder discipline (oss#892): Temporal activities are at-least-once —
 * a workflow task whose completion fails to commit re-executes its local
 * activities (their markers never landed), so count-exact recorder pins
 * flake under CI load. Every test therefore mints a unique execution id, and
 * afterEach settles every started workflow so none outlives its script
 * window.
 *
 * Runs on TestWorkflowEnvironment.createLocal, which downloads and caches
 * its own Temporal CLI dev server; when that server cannot start, every
 * test skips visibly with the reason printed, inside the test gate too
 * (no helper here turns a missing server into a failure).
 */
import { fromJson, toJson, create } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import proto from "@temporalio/proto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  RunSchema,
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import { capturedSet } from "../../../domain/run/__tests__/file-review-seed.js";

import {
  ENSURE_THREAD_ACTIVITY_NAME,
  EXECUTE_DEEP_AGENT_ACTIVITY_NAME,
  GENERATE_SESSION_SUBJECT_ACTIVITY_NAME,
  INVOKE_AGENT_EXECUTION_WORKFLOW_NAME,
  MEMO_ACTIVITY_TASK_QUEUE,
  SIGNAL_APPROVAL_GATE_RESOLVED,
  SIGNAL_PAUSE,
  SIGNAL_RESUME,
  START_QUEUED_TURN_ACTIVITY_NAME,
} from "../names.js";
import type { InvokeAgentExecutionWorkflowInput } from "../workflow-input.js";

const TASK_QUEUE = "invoke-workflow-test";
const WORKFLOWS_PATH = new URL("../workflows/index.ts", import.meta.url)
  .pathname;

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
// When the local Temporal test server cannot start (no `temporal` CLI),
// every test calls testCtx.skip() — VISIBLY skipped, never a vacuous
// green: a silent pass here would mean the whole orchestration contract
// stopped being tested.
let envReady = false;

// ─── Scriptable activity doubles ────────────────────────────────────────
// Each test scripts behaviors through this mutable harness; afterEach
// resets it so tests stay order-independent.

interface RecordedStatus {
  readonly executionId: string;
  readonly status: RunStatus;
}

interface ActivityScript {
  /** Consumed per ExecuteDeepAgent/ExecuteCursor invocation, in order. */
  executeBehaviors: Array<
    (input: {
      execution_id: string;
      thread_id: string;
      turn_seq: number;
    }) => Promise<Record<string, unknown>>
  >;
  executeCalls: Array<{ thread_id: string; turn_seq: number }>;
  /** Each CloseFileReview call's (execution id, session id), in order. */
  closeCalls: Array<[string, string]>;
  /** What ran, in order: "close" per CloseFileReview, "execute" per Execute* invocation. */
  order: string[];
  /** When set, CloseFileReview fails with it (non-retryable). */
  closeFault: string | undefined;
  /** Each StartQueuedTurn call's session id, in order. */
  queuedTurnCalls: string[];
  /** When set, StartQueuedTurn fails with it (non-retryable). */
  queuedTurnFault: string | undefined;
  /**
   * The `execution_context_token` each Execute* invocation carried, in
   * order — `undefined` when the key was absent. Recorded beside
   * executeCalls so the arms that pin thread/turn shape stay exact.
   */
  executeCredentials: Array<string | undefined>;
  /**
   * The argument each GenerateSessionSubject invocation received, verbatim:
   * the positional execution id when the dispatch carried no credential,
   * the typed object when it did (the runner accepts both).
   */
  subjectArguments: unknown[];
  /** Consumed per LoadAgentExecution call, in order; last one sticks. */
  loadResults: JsonValue[];
  /** How many times LoadAgentExecution was called. */
  loadCalls: number;
  /** Consumed per CountOpenGates call, in order; last one sticks. An Error fails the call. */
  openGateCounts: Array<number | Error>;
  /** Each CountOpenGates call's (execution id, session id), in order. */
  gateCalls: Array<[string, string]>;
  /** Consumed per ReadHarnessStateId call, in order; last one sticks. */
  harnessStateIds: Array<string | (() => Promise<string>)>;
  persistedStatuses: RecordedStatus[];
  deletedExecutionContexts: string[];
  ensureThreadResult: string;
  /**
   * Resolvers for deliberately-blocked invocations; afterEach releases
   * them so the worker's activity drain (afterAll shutdown) never hangs
   * on a promise the workflow already abandoned.
   */
  releaseBlocked: Array<() => void>;
}

let script: ActivityScript;

/**
 * Per-test execution identity (oss#892): a workflow that outlives its
 * test window keeps pushing into the CURRENT test's recorders. Unique
 * ids make any such leak attributable to its test — with a shared id, a
 * foreign push is indistinguishable from a legitimate one.
 */
let executionSeq = 0;
let currentExecutionId = "exec-0";

function resetScript(): void {
  for (const release of script?.releaseBlocked ?? []) {
    release();
  }
  currentExecutionId = `exec-${++executionSeq}`;
  script = {
    executeBehaviors: [],
    executeCalls: [],
    closeCalls: [],
    order: [],
    closeFault: undefined,
    queuedTurnCalls: [],
    queuedTurnFault: undefined,
    executeCredentials: [],
    subjectArguments: [],
    loadResults: [],
    loadCalls: 0,
    openGateCounts: [],
    gateCalls: [],
    harnessStateIds: [],
    persistedStatuses: [],
    deletedExecutionContexts: [],
    ensureThreadResult: "thread-1",
    releaseBlocked: [],
  };
}
resetScript();

/** An invocation that blocks until afterEach releases it. */
function blockedInvocation(): Promise<Record<string, unknown>> {
  return new Promise<Record<string, unknown>>((resolve) => {
    script.releaseBlocked.push(() =>
      resolve(slimResult(RunPhase.RUN_COMPLETED)),
    );
  });
}

function slimResult(
  phase: RunPhase,
  error?: string,
): Record<string, unknown> {
  const status = create(RunStatusSchema, {
    phase,
    ...(error !== undefined ? { error } : {}),
  });
  return toJson(RunStatusSchema, status) as Record<string, unknown>;
}

/** An execution snapshot with the given status, as the load activity returns it. */
function executionJson(status: RunStatus): JsonValue {
  return toJson(
    RunSchema,
    create(RunSchema, {
      metadata: { id: currentExecutionId },
      status,
    }),
  );
}

/** An empty gate beside a captured change set nobody decided: the set holds nothing. */
function statusAwaitingReviewOnly(): RunStatus {
  return create(RunStatusSchema, {
    phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
    fileChanges: [capturedSet(`${currentExecutionId}:0`)],
  });
}

function scriptedActivities(): Record<string, (...args: never[]) => Promise<unknown>> {
  const takeExecuteBehavior = (input: {
    execution_id: string;
    thread_id: string;
    turn_seq: number;
    execution_context_token?: string;
  }) => {
    script.executeCalls.push({
      thread_id: input.thread_id,
      turn_seq: input.turn_seq,
    });
    script.order.push("execute");
    script.executeCredentials.push(
      "execution_context_token" in input
        ? input.execution_context_token
        : undefined,
    );
    const behavior = script.executeBehaviors.shift();
    if (behavior === undefined) {
      throw new Error("test script exhausted: unexpected agent invocation");
    }
    return behavior(input);
  };

  return {
    EnsureThread: async (): Promise<string> => script.ensureThreadResult,
    GenerateSessionSubject: async (argument: unknown): Promise<void> => {
      script.subjectArguments.push(argument);
    },
    ExecuteDeepAgent: takeExecuteBehavior as never,
    ExecuteCursor: takeExecuteBehavior as never,
    UpdateExecutionStatus: async (
      executionId: string,
      statusJson: JsonValue,
    ): Promise<void> => {
      script.persistedStatuses.push({
        executionId,
        status: fromJson(RunStatusSchema, statusJson),
      });
    },
    CloseFileReview: async (executionId: string, sessionId: string): Promise<void> => {
      script.closeCalls.push([executionId, sessionId]);
      script.order.push("close");
      if (script.closeFault !== undefined) {
        const { ApplicationFailure } = await import("@temporalio/common");
        throw ApplicationFailure.create({ message: script.closeFault, nonRetryable: true });
      }
    },
    StartQueuedTurn: async (sessionId: string): Promise<void> => {
      script.queuedTurnCalls.push(sessionId);
      script.order.push("queued");
      if (script.queuedTurnFault !== undefined) {
        const { ApplicationFailure } = await import("@temporalio/common");
        throw ApplicationFailure.create({ message: script.queuedTurnFault, nonRetryable: true });
      }
    },
    LoadAgentExecution: async (): Promise<JsonValue> => {
      script.loadCalls++;
      const result =
        script.loadResults.length > 1
          ? script.loadResults.shift()!
          : script.loadResults[0];
      if (result === undefined) {
        throw new Error("test script exhausted: unexpected LoadAgentExecution");
      }
      return result;
    },
    CountOpenGates: async (executionId: string, sessionId: string): Promise<number> => {
      script.gateCalls.push([executionId, sessionId]);
      const entry =
        script.openGateCounts.length > 1
          ? script.openGateCounts.shift()!
          : script.openGateCounts[0];
      if (entry === undefined) {
        throw new Error("test script exhausted: unexpected CountOpenGates");
      }
      if (entry instanceof Error) {
        const { ApplicationFailure } = await import("@temporalio/common");
        throw ApplicationFailure.create({ message: entry.message, nonRetryable: true });
      }
      return entry;
    },
    ReadHarnessStateId: async (): Promise<string> => {
      const entry =
        script.harnessStateIds.length > 1
          ? script.harnessStateIds.shift()!
          : script.harnessStateIds[0];
      if (entry === undefined) {
        throw new Error("test script exhausted: unexpected ReadHarnessStateId");
      }
      return typeof entry === "function" ? entry() : entry;
    },
    // The retired run-end cleanup, still registered for histories that
    // call it; a new run never does.
    DeleteExecutionContext: async (executionId: string): Promise<void> => {
      script.deletedExecutionContexts.push(executionId);
    },
  };
}

// ─── Workflow start helpers ─────────────────────────────────────────────

function workflowInput(
  overrides: Partial<InvokeAgentExecutionWorkflowInput> = {},
): InvokeAgentExecutionWorkflowInput {
  return {
    execution_id: currentExecutionId,
    session_id: "ses-1",
    agent_id: "agt-1",
    ...overrides,
  };
}

let workflowSeq = 0;

/** Every started workflow, settled by afterEach (oss#892). */
const startedHandles: Array<import("@temporalio/client").WorkflowHandle> = [];

async function startWorkflow(
  input: InvokeAgentExecutionWorkflowInput,
): Promise<import("@temporalio/client").WorkflowHandle> {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  workflowSeq++;
  const handle = await env.client.workflow.start(
    INVOKE_AGENT_EXECUTION_WORKFLOW_NAME,
    {
      taskQueue: TASK_QUEUE,
      workflowId: `invoke-test-${workflowSeq}-${Date.now()}`,
      args: [input],
      memo: { [MEMO_ACTIVITY_TASK_QUEUE]: TASK_QUEUE },
    },
  );
  startedHandles.push(handle);
  return handle;
}

/** Polls the recorder until a status with the given phase lands. */
async function waitForPersistedPhase(
  phase: RunPhase,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (script.persistedStatuses.some((entry) => entry.status.phase === phase)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `no persisted status reached phase ${RunPhase[phase]} within ${timeoutMs}ms; ` +
      `saw [${script.persistedStatuses.map((entry) => RunPhase[entry.status.phase]).join(", ")}]`,
  );
}

/**
 * A new run records the values-fetched patch and never calls the retired
 * run-end cleanup (names.ts RETIRED_DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME):
 * nothing is stored for it to delete. Only a replay of a history that
 * called it makes the call again (replay.test.ts).
 */
function expectRetiredCleanupSkipped(): void {
  expect(
    script.deletedExecutionContexts,
    "a new run never calls the retired cleanup",
  ).toEqual([]);
}

describe("invoke-agent-execution workflow (TestWorkflowEnvironment)", () => {
  beforeAll(async () => {
    try {
      const { TestWorkflowEnvironment: TWE } = await import(
        "@temporalio/testing"
      );
      const { Worker: W } = await import("@temporalio/worker");
      env = await TWE.createLocal();
      worker = await W.create({
        connection: env.nativeConnection,
        taskQueue: TASK_QUEUE,
        workflowsPath: WORKFLOWS_PATH,
        activities: scriptedActivities(),
      });
      workerRunPromise = worker.run();
      envReady = true;
    } catch (error) {
      console.warn(
        `Temporal test server unavailable (tests will be skipped): ${error instanceof Error ? error.message : String(error)}`,
      );
      envReady = false;
    }
  }, 120_000);

  afterAll(async () => {
    if (worker) {
      worker.shutdown();
      await workerRunPromise?.catch(() => {});
    }
    if (env) await env.teardown();
  }, 30_000);

  afterEach(async () => {
    // Settle every workflow this test started BEFORE the script resets:
    // a workflow that outlives its test re-enters the NEXT test's script
    // (observed on CI as "test script exhausted" activity retries plus a
    // foreign recorder push — oss#892). Terminating an already-terminal
    // workflow throws; that is the common case and is ignored.
    for (const handle of startedHandles.splice(0)) {
      try {
        await handle.terminate("test window closed (oss#892 settle fence)");
      } catch {
        // Already terminal.
      }
      await handle.result().catch(() => {});
    }
    resetScript();
  }, 15_000);

  it("completes the deep-agent happy path, with no run-end cleanup to make", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls).toEqual([{ thread_id: "thread-1", turn_seq: 0 }]);
    expectRetiredCleanupSkipped();
  }, 30_000);

  it("runs an input still carrying the retired callback_token and parent_workflow_id keys as an ordinary run", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    // The shape an older server dispatched for a run a workflow step
    // started; this interface no longer names either key.
    const olderServerInput = {
      ...workflowInput(),
      callback_token: "Y2FsbGJhY2stdG9rZW4=",
      parent_workflow_id: "wex-parent-1",
    };
    const handle = await startWorkflow(olderServerInput);
    await handle.result();

    expect(script.executeCalls).toEqual([{ thread_id: "thread-1", turn_seq: 0 }]);
    expectRetiredCleanupSkipped();

    // The run's own history: a reintroduced signal or cancel to the
    // parent the retired keys named, or an activity that completes the
    // parent's step by its callback token, would be recorded here.
    const history = await handle.fetchHistory();
    const events = history.events ?? [];
    const { EventType } = proto.temporal.api.enums.v1;
    expect(
      events
        .filter(
          (event) =>
            event.eventType ===
              EventType.EVENT_TYPE_SIGNAL_EXTERNAL_WORKFLOW_EXECUTION_INITIATED ||
            event.eventType ===
              EventType.EVENT_TYPE_REQUEST_CANCEL_EXTERNAL_WORKFLOW_EXECUTION_INITIATED,
        )
        .map((event) => EventType[event.eventType ?? 0]),
      "no event may reach another workflow",
    ).toEqual([]);
    expect(
      [
        ...new Set(
          events
            .filter(
              (event) =>
                event.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED,
            )
            .map(
              (event) =>
                event.activityTaskScheduledEventAttributes?.activityType?.name,
            ),
        ),
      ].sort(),
      "the run schedules only an ordinary run's activities",
    ).toEqual(
      [
        ENSURE_THREAD_ACTIVITY_NAME,
        EXECUTE_DEEP_AGENT_ACTIVITY_NAME,
        GENERATE_SESSION_SUBJECT_ACTIVITY_NAME,
        START_QUEUED_TURN_ACTIVITY_NAME,
      ].sort(),
    );
  }, 30_000);

  it("re-invokes after approvalGateResolved with TurnSeq = approvalCycle", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.openGateCounts = [1];

    const handle = await startWorkflow(workflowInput());
    await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
    await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
    await handle.result();

    expect(script.executeCalls).toEqual([
      { thread_id: "thread-1", turn_seq: 0 },
      // The LangGraph thread is stable; TurnSeq mints the deterministic
      // change-set id for the re-invoked turn.
      { thread_id: "thread-1", turn_seq: 1 },
    ]);
    expect(
      script.persistedStatuses.some(
        (entry) =>
          entry.status.phase === RunPhase.RUN_WAITING_FOR_APPROVAL,
      ),
    ).toBe(true);
    // The gate is the turn's open asks in its session's log; the run is
    // never loaded for it.
    expect(script.gateCalls).toEqual([[currentExecutionId, "ses-1"]]);
    expect(script.loadCalls).toBe(0);
    expectRetiredCleanupSkipped();
  }, 30_000);

  it("waits for the signal when the turn's open gates cannot be counted", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.openGateCounts = [new Error("store unavailable")];

    const handle = await startWorkflow(workflowInput());
    await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
    // Counted as one open gate: no re-invocation until the signal.
    expect(script.executeCalls).toHaveLength(1);
    await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
    await handle.result();

    expect(script.executeCalls).toHaveLength(2);
    expect(script.loadCalls).toBe(0);
  }, 30_000);

  it("fails fast after MAX_ZERO_GATE_CYCLES consecutive empty-gate WAITING cycles", async (testCtx) => {    if (!envReady) return testCtx.skip();
    // Every invocation reports WAITING; every load shows an empty gate
    // → 3 tolerated cycles, then fail.
    script.executeBehaviors = Array.from({ length: 8 }, () => async () =>
      slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
    );
    script.openGateCounts = [0];

    const handle = await startWorkflow(workflowInput());
    await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

    // 1 first invoke + 3 tolerated zero-gate re-invokes, then fail-fast.
    expect(script.executeCalls).toHaveLength(4);
    const failed = script.persistedStatuses.filter(
      (entry) => entry.status.phase === RunPhase.RUN_FAILED,
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(failed.at(-1)!.status.error).toContain(
      "gate propagation is broken",
    );
  }, 60_000);

  it("never waits on a change set awaiting review: a gate with no pending approval is empty (stigmer#1471)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = Array.from({ length: 8 }, () => async () =>
      slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
    );
    // The run holds a set awaiting review; the gate counts the log's open
    // asks alone, and none is open.
    script.loadResults = [executionJson(statusAwaitingReviewOnly())];
    script.openGateCounts = [0];

    const handle = await startWorkflow(workflowInput());
    // No signal is ever sent: a review-held gate would wait forever here.
    await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

    expect(script.executeCalls).toHaveLength(4);
    expect(script.loadCalls).toBe(0);
  }, 60_000);

  it("closes the previous turn's file review first, with the run and its session, before the runner", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.closeCalls).toEqual([[currentExecutionId, "ses-1"]]);
    expect(script.order).toEqual(["close", "execute", "queued"]);
    expect(script.subjectArguments).toEqual([currentExecutionId]);
  }, 30_000);

  it("runs the turn when the close fails: the close only records what the window already says", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.closeFault = "store unavailable";
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.order).toEqual(["close", "execute", "queued"]);
  }, 30_000);

  it("a reconcile turn closes no file review and titles no session, on either harness", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.harnessStateIds = [""];

    await (await startWorkflow(workflowInput({ reconcile_file_review: true }))).result();
    await (
      await startWorkflow(workflowInput({ reconcile_file_review: true, harness: Harness.CURSOR }))
    ).result();

    expect(script.executeCalls).toHaveLength(2);
    expect(script.closeCalls).toEqual([]);
    expect(script.subjectArguments).toEqual([]);
  }, 30_000);

  it("pauses on the pause signal, persists PAUSED, and re-invokes on resume", async (testCtx) => {    if (!envReady) return testCtx.skip();
    const firstStarted = new Promise<void>((resolve) => {
      script.executeBehaviors = [
        (): Promise<Record<string, unknown>> => {
          resolve();
          // Blocks until the pause cancels it (released in afterEach).
          return blockedInvocation();
        },
        async () => slimResult(RunPhase.RUN_COMPLETED),
      ];
    });

    const handle = await startWorkflow(workflowInput());
    await firstStarted;
    await handle.signal(SIGNAL_PAUSE, "Paused by user");
    await waitForPersistedPhase(RunPhase.RUN_PAUSED);
    await handle.signal(SIGNAL_RESUME);
    await handle.result();

    expect(script.executeCalls.map((call) => call.turn_seq)).toEqual([0, 0]);
    const phases = script.persistedStatuses.map((entry) => entry.status.phase);
    const pausedAt = phases.indexOf(RunPhase.RUN_PAUSED);
    expect(pausedAt, "the pause branch persists PAUSED").toBeGreaterThanOrEqual(0);
    // The resume path re-asserts IN_PROGRESS AFTER the PAUSED persist —
    // the oss#869 healing write (a deliberate TS addition): the PAUSED
    // defense persist can land over a fast resume's IN_PROGRESS, and this
    // sequenced write is what guarantees the phase never sticks PAUSED
    // while the resumed turn runs.
    expect(
      phases
        .slice(pausedAt + 1)
        .includes(RunPhase.RUN_IN_PROGRESS),
      "resume re-asserts IN_PROGRESS after the PAUSED persist",
    ).toBe(true);
    // The runner cannot tell this stop from a cancel; the workflow says
    // whose stop it was.
    expect(
      script.persistedStatuses[pausedAt]!.status.stopCause,
      "the PAUSED persist says the person stopped it",
    ).toBe("user");
  }, 60_000);

  it("auto-recovers a worker-shutdown interruption and persists IN_PROGRESS (#776)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    const { ApplicationFailure } = await import("@temporalio/common");
    script.executeBehaviors = [
      async () => {
        // The Temporal TS worker's drain shape (runnerfailure drainMarker).
        throw ApplicationFailure.create({
          message:
            "Worker is shutting down and this activity did not complete in time",
          nonRetryable: true,
        });
      },
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls).toHaveLength(2);
    expect(
      script.persistedStatuses.some(
        (entry) => entry.status.phase === RunPhase.RUN_IN_PROGRESS,
      ),
    ).toBe(true);
  }, 60_000);

  it("auto-recovers a turn that yielded to continue (the typed StigmerTurnContinues failure, stigmer#2428)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    const { ApplicationFailure, ApplicationFailureCategory } = await import("@temporalio/common");
    script.executeBehaviors = [
      async () => {
        // The runner's drained turn: no cancellation was delivered, so it
        // reaches the workflow as an application failure of its own type.
        throw ApplicationFailure.create({
          type: "StigmerTurnContinues",
          message: "The turn continues on the next invocation",
          details: ["drain"],
          category: ApplicationFailureCategory.BENIGN,
        });
      },
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls, "the turn is invoked again and completes").toHaveLength(2);
    expect(
      script.persistedStatuses.some((entry) => entry.status.phase === RunPhase.RUN_FAILED),
      "a continued turn never shows FAILED",
    ).toBe(false);
  }, 60_000);

  it("auto-recovers a turn whose model stopped answering (a StigmerTurnContinues model stall)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    const { ApplicationFailure, ApplicationFailureCategory } = await import("@temporalio/common");
    script.executeBehaviors = [
      async () => {
        // The runner's stall while its turn waited on the model: continued,
        // carrying the stall's own copy for a give-up.
        throw ApplicationFailure.create({
          type: "StigmerTurnContinues",
          message: "[StallTimeoutError] Agent stream stalled: no activity for 180s. Retry or resume.",
          details: ["model-stall"],
          category: ApplicationFailureCategory.BENIGN,
        });
      },
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls, "the turn is invoked again and completes").toHaveLength(2);
    expect(
      script.persistedStatuses.some((entry) => entry.status.phase === RunPhase.RUN_FAILED),
      "a continued turn never shows FAILED",
    ).toBe(false);
  }, 60_000);

  it("auto-recovers a turn whose engine's vendor ended its connection (a StigmerTurnContinues stream cut, stigmer#2436)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    const { ApplicationFailure, ApplicationFailureCategory } = await import("@temporalio/common");
    script.executeBehaviors = [
      async () => {
        // Cursor's side ended the run's stream: continued, carrying the
        // runner's words for the cut for a give-up.
        throw ApplicationFailure.create({
          type: "StigmerTurnContinues",
          message: "[unknown] [canceled] http/2 stream closed with error code CANCEL (0x8) [category=stream-cut, source=sdk, retryable=true]",
          details: ["stream-cut"],
          category: ApplicationFailureCategory.BENIGN,
        });
      },
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls, "the turn is invoked again and completes").toHaveLength(2);
    expect(
      script.persistedStatuses.some((entry) => entry.status.phase === RunPhase.RUN_FAILED),
      "a continued turn never shows FAILED",
    ).toBe(false);
  }, 60_000);

  // NOTE: full recovery EXHAUSTION (11 interrupted invocations, ~275s of
  // real linear backoff) is not exercised here — createLocal does not
  // auto-skip timers the way Go's test env does. The classifier and the
  // honest-copy mapping it feeds are pinned by runner-failure.test.ts, the
  // per-hour count by recovery-window.test.ts; the recovery loop mechanics
  // are pinned by the single-cycle tests above.

  it("propagates RUN_FAILED results with the fallback persist", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_FAILED, "agent blew up"),
    ];

    const handle = await startWorkflow(workflowInput());
    await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

    const failed = script.persistedStatuses.filter(
      (entry) => entry.status.phase === RunPhase.RUN_FAILED,
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.status.error).toBe("agent blew up");
    // The runner's own failure carries its cause; no FAILED write of the
    // workflow names another.
    expect(
      failed.map((entry) => entry.status.stopCause),
      "a runner-reported failure adds no cause of the workflow's",
    ).toEqual(failed.map(() => ""));
    expectRetiredCleanupSkipped();
  }, 30_000);

  it("names a flow that broke without a runner verdict failed, with its wrapped error", async (testCtx) => {    if (!envReady) return testCtx.skip();
    const { ApplicationFailure } = await import("@temporalio/common");
    script.executeBehaviors = [
      async () => {
        // Not recoverable (not a cancellation, heartbeat timeout or worker
        // shutdown), so the flow breaks with no FAILED result to read.
        throw ApplicationFailure.create({ message: "runner crashed", nonRetryable: true });
      },
    ];

    const handle = await startWorkflow(workflowInput());
    await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

    const failed = script.persistedStatuses.filter(
      (entry) => entry.status.phase === RunPhase.RUN_FAILED,
    );
    expect(failed.length).toBeGreaterThan(0);
    const last = failed.at(-1)!.status;
    expect(last.stopCause).toBe("failed");
    // The error carries the wrapped activity error (wrapActivityError's
    // operator-actionable prefix), not a runner-authored sentence.
    expect(last.error).toMatch(/^activity 'ExecuteDeepAgent'/);
    expectRetiredCleanupSkipped();
  }, 30_000);

  it("cancellation persists CANCELLED quietly, with no run-end cleanup to make (stigmer#282)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    const started = new Promise<void>((resolve) => {
      script.executeBehaviors = [
        (): Promise<Record<string, unknown>> => {
          resolve();
          // Blocks until the cancellation abandons it (released in afterEach).
          return blockedInvocation();
        },
      ];
    });

    const handle = await startWorkflow(workflowInput());
    await started;
    await handle.cancel();
    await expect(handle.result()).rejects.toThrow();

    await waitForPersistedPhase(RunPhase.RUN_CANCELLED);
    const cancelled = script.persistedStatuses.find(
      (entry) => entry.status.phase === RunPhase.RUN_CANCELLED,
    )!;
    // Cancel is a QUIET terminal state: no status.error; its cause is the
    // person's.
    expect(cancelled.status.error).toBe("");
    expect(cancelled.status.stopCause).toBe("user");
    expectRetiredCleanupSkipped();
  }, 60_000);

  it("starts the session's queued turn as the workflow's last act, on every end", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];
    await (await startWorkflow(workflowInput())).result();
    expect(script.queuedTurnCalls, "completed").toEqual(["ses-1"]);
    expect(script.order.at(-1)).toBe("queued");

    resetScript();
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_FAILED, "agent blew up")];
    await expect((await startWorkflow(workflowInput())).result()).rejects.toThrow(/Workflow execution failed/);
    expect(script.queuedTurnCalls, "failed by the runner").toEqual(["ses-1"]);

    resetScript();
    const started = new Promise<void>((resolve) => {
      script.executeBehaviors = [
        (): Promise<Record<string, unknown>> => {
          resolve();
          return blockedInvocation();
        },
      ];
    });
    const cancelled = await startWorkflow(workflowInput());
    await started;
    await cancelled.cancel();
    await expect(cancelled.result()).rejects.toThrow();
    expect(script.queuedTurnCalls, "cancelled").toEqual(["ses-1"]);
  }, 60_000);

  it("starts no queued turn for a run in no session, and a failing start changes nothing about the end", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];
    await (await startWorkflow(workflowInput({ session_id: "" }))).result();
    expect(script.queuedTurnCalls).toEqual([]);

    resetScript();
    script.queuedTurnFault = "the server is restarting";
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];
    await expect((await startWorkflow(workflowInput())).result()).resolves.toBeUndefined();
    expect(script.queuedTurnCalls).toEqual(["ses-1"]);
  }, 60_000);

  it("cursor flow re-reads harness_state_id before each re-invocation", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.openGateCounts = [1];
    // First read: empty (the activity creates the Cursor agent); the
    // re-invocation read returns the stored agentId for Agent.resume.
    script.harnessStateIds = ["", "cursor-agent-1"];

    const handle = await startWorkflow(
      workflowInput({ harness: Harness.CURSOR }),
    );
    await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
    await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
    await handle.result();

    expect(script.executeCalls).toEqual([
      { thread_id: "", turn_seq: 0 },
      { thread_id: "cursor-agent-1", turn_seq: 1 },
    ]);
  }, 30_000);

  it("hands the run credential to every deep-agent invocation — the first turn and the re-invocation alike", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.openGateCounts = [1];

    const handle = await startWorkflow(
      workflowInput({ execution_context_token: "run-credential-1" }),
    );
    await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
    await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
    await handle.result();

    expect(script.executeCredentials).toEqual([
      "run-credential-1",
      "run-credential-1",
    ]);
  }, 30_000);

  it("hands the run credential to the cursor invocation too", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.harnessStateIds = [""];

    const handle = await startWorkflow(
      workflowInput({
        harness: Harness.CURSOR,
        execution_context_token: "run-credential-2",
      }),
    );
    await handle.result();

    expect(script.executeCredentials).toEqual(["run-credential-2"]);
  }, 30_000);

  it("omits the credential key when the dispatch carried none — the omitempty shape an in-flight history has", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCredentials).toEqual([undefined]);
  }, 30_000);

  it("calls GenerateSessionSubject with the typed object carrying the run credential when the dispatch has one", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(
      workflowInput({ execution_context_token: "run-credential-3" }),
    );
    await handle.result();

    expect(script.subjectArguments).toEqual([
      {
        execution_id: currentExecutionId,
        execution_context_token: "run-credential-3",
      },
    ]);
  }, 30_000);

  it("calls GenerateSessionSubject with the positional execution id when the dispatch carried no credential — the shape every earlier runner accepts", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.subjectArguments).toEqual([currentExecutionId]);
  }, 30_000);
});
