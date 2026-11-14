/**
 * Invoke-workflow orchestration tests — the scenario matrix, on a
 * TestWorkflowEnvironment with mocked activities and a persisted-status
 * recorder.
 *
 * What these pin (all load-bearing orchestration contracts):
 *   - the happy path (EnsureThread → ExecuteDeepAgent), and
 *     the same run from an input carrying keys the input interface does
 *     not name: the keys are ignored and it runs as an ordinary run, its
 *     own history recording no signal or cancel to another workflow and
 *     no activity beyond an ordinary run's;
 *   - the HITL loop (WAITING persist → gate re-read → approvalGateResolved
 *     → re-invoke with TurnSeq = approvalCycle — the deterministic
 *     change-set id input); a new run reads its gate as the count of the
 *     turn's open asks in its session's log (CountOpenGates, with the run
 *     and its session), and a count that cannot be read waits for the
 *     signal;
 *   - the zero-gate fail-fast bound (MAX_ZERO_GATE_CYCLES): file review
 *     never holds a turn, so a gate with no pending approval is empty
 *     whatever its change sets say (stigmer#1471);
 *   - a message turn closes the previous turn's file review first
 *     (CloseFileReview, with the run and its session, before the runner),
 *     and a failing close never fails the turn; a reconcile turn
 *     (`reconcile_file_review`) closes nothing and titles no session;
 *   - pause/resume (activity cancelled, PAUSED persisted, resume
 *     re-invokes) — a CancellationScope per attempt;
 *   - bounded auto-recovery on worker-shutdown shapes (#776: IN_PROGRESS
 *     persisted, honest status copy on exhaustion);
 *   - RUN_FAILED propagation with the fallback persist;
 *   - each stop and failure write says the stop's cause and no transcript
 *     line: the pause persist and the cancellation `user`, a broken flow
 *     `failed` with its wrapped error, a runner-reported failure none of
 *     its own (the runner's write states it);
 *   - external cancellation cleanup (CANCELLED persisted quietly —
 *     stigmer#282);
 *   - the engine switch: Stigmer and Claude share the deterministic-state
 *     flow (EnsureThread's thread on every invocation), each on its own
 *     Execute* activity; a number no harness owns (2 among them) fails
 *     the run naming it and runs nothing, never as
 *     Stigmer;
 *   - every end of the workflow (completed, failed by the runner, broken,
 *     cancelled) calls StartQueuedTurn with the run's session as its last
 *     act; a run in no session calls nothing; a StartQueuedTurn that fails
 *     changes nothing about how the workflow ends;
 *   - the run credential handed on (2026-09-16): the workflow input's
 *     `execution_context_token` reaches EVERY Execute* invocation, first
 *     turn and re-invocation, both harnesses, and the key is absent when
 *     the dispatch carried none;
 *   - the wait for a sandbox with room (../sandbox-wait.ts): on a CLOUD
 *     target whose input carries the caller's class, EnsureSessionSandbox
 *     runs before the runner with the caller's facts; while it answers
 *     no_room the run is written PENDING with the waiting phase text and
 *     asked again, and the turn runs once room comes; a wait past the
 *     input's limit fails the run as infrastructure / no_sandbox_room
 *     with the person's sentence and runs nothing; a cancel while waiting
 *     ends it CANCELLED; a pause while waiting takes no sandbox until
 *     resume, then waits again on a fresh clock; an ensure that answers
 *     `failed`, or fails as an older server's worker would (the activity
 *     not registered), goes on to the runner; a LOCAL target, and an
 *     input without the caller's class, never ask. These waits are short
 *     real seconds (the asks are 5 s apart), on the same local server;
 *   - a turn asks for its sandbox again before every runner invocation
 *     after its first, since a parked turn's sandbox may have gone to
 *     sleep (stigmer#3122): after an approval (IN_PROGRESS written
 *     first), after a resume and before a recovery attempt; a full pool
 *     there waits PENDING as a new turn does, writes IN_PROGRESS once room
 *     comes, and ends as no_sandbox_room past the limit; a pause during
 *     that wait is taken once by the attempt's monitor and the turn asks
 *     again on resume; a LOCAL target asks nothing.
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

import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ExecutionTarget, Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import {
  ENSURE_THREAD_ACTIVITY_NAME,
  EXECUTE_DEEP_AGENT_ACTIVITY_NAME,
  GENERATE_SESSION_SUBJECT_ACTIVITY_NAME,
} from "@stigmer/temporal-codecs/activity-names";
import {
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
  /** Consumed per Execute* invocation (every harness), in order. */
  executeBehaviors: Array<
    (input: {
      execution_id: string;
      thread_id: string;
      turn_seq: number;
    }) => Promise<Record<string, unknown>>
  >;
  executeCalls: Array<{ thread_id: string; turn_seq: number }>;
  /** The Execute* activity each invocation reached, in order. */
  executeActivities: string[];
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
   * the typed object, carrying the run credential when the dispatch did.
   */
  subjectArguments: unknown[];
  /** Consumed per EnsureSessionSandbox call, in order; `sandboxDefault` once empty. */
  sandboxAnswers: string[];
  /** EnsureSessionSandbox's answer once `sandboxAnswers` is used up; "throw" fails the call. */
  sandboxDefault: string;
  /** Each EnsureSessionSandbox call's input, in order. */
  sandboxCalls: Array<Record<string, unknown>>;
  /** The phase persisted last before each EnsureSessionSandbox call (undefined for none), in order. */
  sandboxAfterPhases: Array<RunPhase | undefined>;
  /** Consumed per CountOpenGates call, in order; last one sticks. An Error fails the call. */
  openGateCounts: Array<number | Error>;
  /** Each CountOpenGates call's (execution id, session id), in order. */
  gateCalls: Array<[string, string]>;
  persistedStatuses: RecordedStatus[];
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
    executeActivities: [],
    closeCalls: [],
    order: [],
    closeFault: undefined,
    queuedTurnCalls: [],
    queuedTurnFault: undefined,
    executeCredentials: [],
    subjectArguments: [],
    sandboxAnswers: [],
    sandboxDefault: "ready",
    sandboxCalls: [],
    sandboxAfterPhases: [],
    openGateCounts: [],
    gateCalls: [],
    persistedStatuses: [],
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
    ExecuteDeepAgent: ((input: Parameters<typeof takeExecuteBehavior>[0]) => {
      script.executeActivities.push("ExecuteDeepAgent");
      return takeExecuteBehavior(input);
    }) as never,
    ExecuteClaude: ((input: Parameters<typeof takeExecuteBehavior>[0]) => {
      script.executeActivities.push("ExecuteClaude");
      return takeExecuteBehavior(input);
    }) as never,
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
    EnsureSessionSandbox: async (input: Record<string, unknown>): Promise<string> => {
      script.sandboxCalls.push(input);
      script.sandboxAfterPhases.push(script.persistedStatuses.at(-1)?.status.phase);
      script.order.push("sandbox");
      const answer = script.sandboxAnswers.shift() ?? script.sandboxDefault;
      if (answer === "throw") {
        // What an older server's worker answers for an activity it never registered, past every retry.
        const { ApplicationFailure } = await import("@temporalio/common");
        throw ApplicationFailure.create({ message: "Activity function EnsureSessionSandbox is not registered on this Worker", nonRetryable: true });
      }
      return answer;
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
  };
}

// ─── Workflow start helpers ─────────────────────────────────────────────

function workflowInput(
  overrides: Partial<InvokeAgentExecutionWorkflowInput> = {},
): InvokeAgentExecutionWorkflowInput {
  return {
    execution_id: currentExecutionId,
    session_id: "ses_1",
    agent_id: "agt_1",
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

  it("completes the deep-agent happy path", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls).toEqual([{ thread_id: "thread-1", turn_seq: 0 }]);
  }, 30_000);

  it("runs an input carrying keys the input interface does not name as an ordinary run", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    // Keys the input interface does not name: the plain-JSON input
    // decodes them and the workflow acts on none.
    const inputWithUnknownKeys = {
      ...workflowInput(),
      callback_token: "Y2FsbGJhY2stdG9rZW4=",
      parent_workflow_id: "parent-1",
    };
    const handle = await startWorkflow(inputWithUnknownKeys);
    await handle.result();

    expect(script.executeCalls).toEqual([{ thread_id: "thread-1", turn_seq: 0 }]);

    // The run's own history: a signal or cancel to the parent those keys
    // name, or an activity that completes a step by the callback token,
    // would be recorded here.
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
    // The gate is the turn's open asks in its session's log.
    expect(script.gateCalls).toEqual([[currentExecutionId, "ses_1"]]);
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

  it("closes the previous turn's file review first, with the run and its session, before the runner", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.closeCalls).toEqual([[currentExecutionId, "ses_1"]]);
    expect(script.order).toEqual(["close", "execute", "queued"]);
    expect(script.subjectArguments).toEqual([{ execution_id: currentExecutionId }]);
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

    await (await startWorkflow(workflowInput({ reconcile_file_review: true }))).result();
    await (
      await startWorkflow(workflowInput({ reconcile_file_review: true, harness: Harness.CLAUDE }))
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

  // NOTE: full recovery EXHAUSTION (11 interrupted invocations, ~275s of
  // real linear backoff) is not exercised here — createLocal does not
  // auto-skip timers. The classifier and the
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
  }, 30_000);

  it("cancellation persists CANCELLED quietly (stigmer#282)", async (testCtx) => {    if (!envReady) return testCtx.skip();
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
  }, 60_000);

  it("starts the session's queued turn as the workflow's last act, on every end", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];
    await (await startWorkflow(workflowInput())).result();
    expect(script.queuedTurnCalls, "completed").toEqual(["ses_1"]);
    expect(script.order.at(-1)).toBe("queued");

    resetScript();
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_FAILED, "agent blew up")];
    await expect((await startWorkflow(workflowInput())).result()).rejects.toThrow(/Workflow execution failed/);
    expect(script.queuedTurnCalls, "failed by the runner").toEqual(["ses_1"]);

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
    expect(script.queuedTurnCalls, "cancelled").toEqual(["ses_1"]);
  }, 60_000);

  it("starts no queued turn for a run in no session, and a failing start changes nothing about the end", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];
    await (await startWorkflow(workflowInput({ session_id: "" }))).result();
    expect(script.queuedTurnCalls).toEqual([]);

    resetScript();
    script.queuedTurnFault = "the server is restarting";
    script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];
    await expect((await startWorkflow(workflowInput())).result()).resolves.toBeUndefined();
    expect(script.queuedTurnCalls).toEqual(["ses_1"]);
  }, 60_000);

  for (const [engine, activity] of [
    [Harness.STIGMER, "ExecuteDeepAgent"],
    [Harness.UNSPECIFIED, "ExecuteDeepAgent"],
    [Harness.CLAUDE, "ExecuteClaude"],
  ] as const) {
    it(`harness ${Harness[engine]} runs the deterministic-state flow on ${activity}, its thread stable across an approval`, async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.executeBehaviors = [
        async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
        async () => slimResult(RunPhase.RUN_COMPLETED),
      ];
      script.openGateCounts = [1];
      script.ensureThreadResult = "thread-ses-1";

      const handle = await startWorkflow(workflowInput({ harness: engine }));
      await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
      await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
      await handle.result();

      expect(script.executeActivities).toEqual([activity, activity]);
      expect(script.executeCalls).toEqual([
        { thread_id: "thread-ses-1", turn_seq: 0 },
        { thread_id: "thread-ses-1", turn_seq: 1 },
      ]);
    }, 30_000);
  }

  // Neither 2 nor 7 names a harness.
  for (const unowned of [2, 7]) {
    it(`harness number ${unowned}, which no harness owns, fails the run naming it and never runs as Stigmer`, async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];

      const handle = await startWorkflow(workflowInput({ harness: unowned }));
      await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

      expect(script.executeActivities).toEqual([]);
      const failed = script.persistedStatuses.filter(
        (entry) => entry.status.phase === RunPhase.RUN_FAILED,
      );
      expect(failed.at(-1)?.status.error).toBe(
        `harness ${unowned} names no harness this workflow runs`,
      );
    }, 30_000);
  }

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

  it("hands the run credential to the Claude invocation too", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(
      workflowInput({
        harness: Harness.CLAUDE,
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

  it("calls GenerateSessionSubject with the typed object and no credential when the dispatch carried none", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.subjectArguments).toEqual([{ execution_id: currentExecutionId }]);
  }, 30_000);

  describe("the wait for a sandbox with room", () => {
    const cloud = (overrides: Partial<InvokeAgentExecutionWorkflowInput> = {}) =>
      workflowInput({ execution_target: ExecutionTarget.CLOUD, caller_class: "user", ...overrides });

    const persisted = (phase: RunPhase) => script.persistedStatuses.filter((entry) => entry.status.phase === phase);

    /** Polls until EnsureSessionSandbox has been asked `count` times. */
    async function waitForSandboxCalls(count: number, timeoutMs = 20_000): Promise<void> {
      const deadline = Date.now() + timeoutMs;
      while (script.sandboxCalls.length < count) {
        if (Date.now() > deadline) throw new Error(`EnsureSessionSandbox was asked ${script.sandboxCalls.length} times, not ${count}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    it("asks for the sandbox first with the caller's facts, waits PENDING while there is no room, then runs", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxAnswers = ["no_room"];
      script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];

      await (await startWorkflow(cloud({ routine_id: "rtn_1", caller_identity_id: "ida_1" }))).result();

      expect(script.order.slice(0, 4)).toEqual(["close", "sandbox", "sandbox", "execute"]);
      expect(script.sandboxCalls[0]).toEqual({ execution_id: currentExecutionId, caller_class: "user", routine_id: "rtn_1", caller_identity_id: "ida_1" });
      expect(typeof script.sandboxCalls[1]!["waiting_since_ms"], "the second ask says when the wait began").toBe("number");
      const waiting = persisted(RunPhase.RUN_PENDING);
      expect(waiting).toHaveLength(1);
      expect(waiting[0]!.status.setupProgress?.currentPhase).toBe("Waiting for a sandbox");
    }, 60_000);

    it("ends a wait past its limit as no_sandbox_room with the person's sentence, running nothing", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxDefault = "no_room";

      await expect((await startWorkflow(cloud({ sandbox_wait_seconds: 1 }))).result()).rejects.toThrow(/Workflow execution failed/);

      expect(script.executeCalls).toEqual([]);
      const failed = persisted(RunPhase.RUN_FAILED);
      expect(failed).toHaveLength(1);
      expect(failed[0]!.status.stopCause).toBe("infrastructure");
      expect(failed[0]!.status.stopDetail?.kind).toBe("no_sandbox_room");
      expect(failed[0]!.status.error).toBe(
        "Every sandbox was busy for 1 second, so this turn didn't start. Nothing was lost: run it again to wait for room.",
      );
      expect(script.queuedTurnCalls, "the session's queue still moves").toEqual(["ses_1"]);
    }, 60_000);

    it("ends at once on a zero limit", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxDefault = "no_room";
      await expect((await startWorkflow(cloud({ sandbox_wait_seconds: 0 }))).result()).rejects.toThrow(/Workflow execution failed/);
      expect(script.sandboxCalls).toHaveLength(1);
      expect(persisted(RunPhase.RUN_PENDING), "no waiting write for a wait that never began").toEqual([]);
      expect(persisted(RunPhase.RUN_FAILED)[0]!.status.stopDetail?.kind).toBe("no_sandbox_room");
    }, 60_000);

    it("a cancel while waiting ends the run CANCELLED, quietly", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxDefault = "no_room";
      const handle = await startWorkflow(cloud());
      await waitForPersistedPhase(RunPhase.RUN_PENDING);
      await handle.cancel();
      await expect(handle.result()).rejects.toThrow();

      await waitForPersistedPhase(RunPhase.RUN_CANCELLED);
      expect(persisted(RunPhase.RUN_CANCELLED)[0]!.status.stopCause).toBe("user");
      expect(script.executeCalls).toEqual([]);
    }, 60_000);

    it("a pause while waiting takes no sandbox until resume, then waits again on a fresh clock", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxAnswers = ["no_room", "no_room"];
      script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED)];
      const handle = await startWorkflow(cloud());
      await waitForPersistedPhase(RunPhase.RUN_PENDING);
      await handle.signal(SIGNAL_PAUSE, "Paused by user");
      await waitForPersistedPhase(RunPhase.RUN_PAUSED);
      const asked = script.sandboxCalls.length;
      // Longer than the next ask would have been: a paused run asks nothing.
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      expect(script.sandboxCalls.length, "no ask while paused").toBe(asked);
      expect(persisted(RunPhase.RUN_PAUSED)[0]!.status.stopCause).toBe("user");

      await handle.signal(SIGNAL_RESUME);
      await handle.result();

      const phases = script.persistedStatuses.map((entry) => entry.status.phase);
      expect(phases.slice(phases.indexOf(RunPhase.RUN_PAUSED) + 1)[0], "waiting again right after resume").toBe(RunPhase.RUN_PENDING);
      expect(script.sandboxCalls[asked], "the wait starts over").not.toHaveProperty("waiting_since_ms");
      expect(script.executeCalls).toHaveLength(1);
    }, 60_000);

    it("goes on to the runner when the ensure fails or cannot run at all", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED), async () => slimResult(RunPhase.RUN_COMPLETED)];

      script.sandboxAnswers = ["failed"];
      await (await startWorkflow(cloud())).result();
      script.sandboxAnswers = ["throw"];
      await (await startWorkflow(cloud())).result();

      expect(script.sandboxCalls, "one ask each: neither is a wait").toHaveLength(2);
      expect(script.executeCalls, "both turns ran on the runner's own window").toHaveLength(2);
      expect(persisted(RunPhase.RUN_PENDING), "no waiting write").toEqual([]);
    }, 60_000);

    it("never asks on a LOCAL target, nor for an input without the caller's class", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.executeBehaviors = [async () => slimResult(RunPhase.RUN_COMPLETED), async () => slimResult(RunPhase.RUN_COMPLETED)];
      await (await startWorkflow(workflowInput({ execution_target: ExecutionTarget.LOCAL, caller_class: "user" }))).result();
      await (await startWorkflow(workflowInput({ execution_target: ExecutionTarget.CLOUD }))).result();
      expect(script.sandboxCalls).toEqual([]);
      expect(script.executeCalls).toHaveLength(2);
    }, 60_000);
  });

  describe("a turn asks for its sandbox again before it carries on (stigmer#3122)", () => {
    const cloud = (overrides: Partial<InvokeAgentExecutionWorkflowInput> = {}) =>
      workflowInput({ execution_target: ExecutionTarget.CLOUD, caller_class: "user", ...overrides });

    const phases = () => script.persistedStatuses.map((entry) => entry.status.phase);

    it("after an approval: IN_PROGRESS is written, then the sandbox asked for, then the turn re-invoked", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.executeBehaviors = [
        async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
        async () => slimResult(RunPhase.RUN_COMPLETED),
      ];
      script.openGateCounts = [1];

      const handle = await startWorkflow(cloud());
      await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
      expect(script.sandboxCalls, "one ask while the turn waits for its answer").toHaveLength(1);
      await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
      await handle.result();

      expect(script.order).toEqual(["close", "sandbox", "execute", "sandbox", "execute", "queued"]);
      expect(script.sandboxAfterPhases[1], "the run reads working before its sandbox is asked for").toBe(RunPhase.RUN_IN_PROGRESS);
      expect(script.sandboxCalls[1]).toEqual({ execution_id: currentExecutionId, caller_class: "user" });
      expect(script.executeCalls.map((call) => call.turn_seq)).toEqual([0, 1]);
    }, 60_000);

    it("after a resume: the sandbox is asked for before the next attempt", async (testCtx) => {    if (!envReady) return testCtx.skip();
      const firstStarted = new Promise<void>((resolve) => {
        script.executeBehaviors = [
          (): Promise<Record<string, unknown>> => {
            resolve();
            return blockedInvocation();
          },
          async () => slimResult(RunPhase.RUN_COMPLETED),
        ];
      });

      const handle = await startWorkflow(cloud());
      await firstStarted;
      await handle.signal(SIGNAL_PAUSE, "Paused by user");
      await waitForPersistedPhase(RunPhase.RUN_PAUSED);
      expect(script.sandboxCalls, "a paused turn asks nothing").toHaveLength(1);
      await handle.signal(SIGNAL_RESUME);
      await handle.result();

      expect(script.order).toEqual(["close", "sandbox", "execute", "sandbox", "execute", "queued"]);
      expect(script.sandboxAfterPhases[1], "the resume's IN_PROGRESS lands before the ask").toBe(RunPhase.RUN_IN_PROGRESS);
    }, 60_000);

    it("before a recovery attempt: a drained turn asks for its sandbox before it continues", async (testCtx) => {    if (!envReady) return testCtx.skip();
      const { ApplicationFailure } = await import("@temporalio/common");
      script.executeBehaviors = [
        async () => {
          throw ApplicationFailure.create({
            message: "Worker is shutting down and this activity did not complete in time",
            nonRetryable: true,
          });
        },
        async () => slimResult(RunPhase.RUN_COMPLETED),
      ];

      await (await startWorkflow(cloud())).result();

      expect(script.order).toEqual(["close", "sandbox", "execute", "sandbox", "execute", "queued"]);
      expect(script.sandboxAfterPhases[1], "the recovery's IN_PROGRESS lands before the ask").toBe(RunPhase.RUN_IN_PROGRESS);
    }, 60_000);

    it("a full pool after an approval: the run waits PENDING as a new turn does, then reads IN_PROGRESS and runs", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxAnswers = ["ready", "no_room"];
      script.executeBehaviors = [
        async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
        async () => slimResult(RunPhase.RUN_COMPLETED),
      ];
      script.openGateCounts = [1];

      const handle = await startWorkflow(cloud());
      await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
      await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
      await handle.result();

      expect(script.order).toEqual(["close", "sandbox", "execute", "sandbox", "sandbox", "execute", "queued"]);
      expect(typeof script.sandboxCalls[2]!["waiting_since_ms"], "the third ask is a wait's").toBe("number");
      const seen = phases();
      const waitingAt = seen.indexOf(RunPhase.RUN_PENDING);
      expect(waitingAt, "the run waits PENDING after its answer").toBeGreaterThan(seen.indexOf(RunPhase.RUN_WAITING_FOR_APPROVAL));
      expect(script.persistedStatuses[waitingAt]!.status.setupProgress?.currentPhase).toBe("Waiting for a sandbox");
      expect(seen.slice(waitingAt + 1), "working again once room comes").toContain(RunPhase.RUN_IN_PROGRESS);
      expect(script.executeCalls).toHaveLength(2);
    }, 60_000);

    it("a full pool that never frees ends the resumed turn as no_sandbox_room", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxAnswers = ["ready"];
      script.sandboxDefault = "no_room";
      script.executeBehaviors = [async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL)];
      script.openGateCounts = [1];

      const handle = await startWorkflow(cloud({ sandbox_wait_seconds: 1 }));
      await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
      await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
      await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

      expect(script.executeCalls, "nothing re-invoked").toHaveLength(1);
      const failed = script.persistedStatuses.filter((entry) => entry.status.phase === RunPhase.RUN_FAILED);
      expect(failed.at(-1)!.status.stopDetail?.kind).toBe("no_sandbox_room");
    }, 60_000);

    it("a pause while a resumed turn waits for room is taken once, and the turn asks again on resume", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.sandboxAnswers = ["ready", "no_room", "no_room"];
      script.executeBehaviors = [
        async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
        async () => slimResult(RunPhase.RUN_COMPLETED),
      ];
      script.openGateCounts = [1];

      const handle = await startWorkflow(cloud());
      await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
      await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
      await waitForPersistedPhase(RunPhase.RUN_PENDING);
      await handle.signal(SIGNAL_PAUSE, "Paused by user");
      await waitForPersistedPhase(RunPhase.RUN_PAUSED);
      const asked = script.sandboxCalls.length;
      await handle.signal(SIGNAL_RESUME);
      await handle.result();

      expect(phases().filter((phase) => phase === RunPhase.RUN_PAUSED), "one pause, written once").toHaveLength(1);
      expect(script.sandboxCalls.length, "asked again after the resume").toBeGreaterThan(asked);
      expect(script.sandboxCalls[asked], "a fresh wait").not.toHaveProperty("waiting_since_ms");
      // The pause ended the attempt, so the next one starts at the turn's
      // first invocation, from its checkpoint, as any pause does.
      expect(script.executeCalls.map((call) => call.turn_seq)).toEqual([0, 0]);
    }, 60_000);

    it("a LOCAL target asks nothing after an approval and writes no working phase of its own", async (testCtx) => {    if (!envReady) return testCtx.skip();
      script.executeBehaviors = [
        async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
        async () => slimResult(RunPhase.RUN_COMPLETED),
      ];
      script.openGateCounts = [1];

      const handle = await startWorkflow(workflowInput({ execution_target: ExecutionTarget.LOCAL, caller_class: "user" }));
      await waitForPersistedPhase(RunPhase.RUN_WAITING_FOR_APPROVAL);
      await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
      await handle.result();

      expect(script.sandboxCalls).toEqual([]);
      expect(phases()).not.toContain(RunPhase.RUN_IN_PROGRESS);
    }, 60_000);
  });
});
