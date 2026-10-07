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
 *     dispatch): the keys are ignored and it runs as an ordinary run;
 *   - the HITL loop (WAITING persist → gate re-read → approvalGateResolved
 *     → re-invoke with TurnSeq = approvalCycle — the deterministic
 *     change-set id input);
 *   - the decided-awaiting-reconcile immediate re-invoke;
 *   - the zero-gate fail-fast bound (MAX_ZERO_GATE_CYCLES);
 *   - pause/resume (activity cancelled, PAUSED persisted, resume
 *     re-invokes) — Go's CancellationScope pattern;
 *   - bounded auto-recovery on worker-shutdown shapes (#776: IN_PROGRESS
 *     persisted, honest status copy on exhaustion);
 *   - RUN_FAILED propagation with the fallback persist;
 *   - the stop and failure copy each has one writer (stigmer#980): the
 *     pause persist carries the pause row, a runner-reported failure's
 *     write carries no lines (the runner explained it), and only a broken
 *     flow gets the platform's two lines;
 *   - external cancellation cleanup (CANCELLED persisted quietly —
 *     stigmer#282 — and the EC deleted);
 *   - the cursor flow's harness_state_id re-read discipline;
 *   - the run credential handed on (2026-09-16): the workflow input's
 *     `execution_context_token` reaches EVERY Execute* invocation, first
 *     turn and re-invocation, both harnesses, and the key is absent when
 *     the dispatch carried none.
 *
 * Recorder discipline (oss#892): Temporal activities are at-least-once —
 * a workflow task whose completion fails to commit re-executes its local
 * activities (their markers never landed), so count-exact recorder pins
 * flake under CI load. Delete-recorder assertions therefore pin
 * identity + at-least-once, every test mints a unique execution id, and
 * afterEach settles every started workflow so none outlives its script
 * window.
 *
 * Follows the runner's golden-e2e precedent: TestWorkflowEnvironment
 * .createLocal (needs the `temporal` CLI on PATH); every test skips
 * gracefully when the local test server cannot start.
 */
import { fromJson, toJson, create } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AgentRunSchema,
  AgentRunStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import type { AgentRunStatus } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import {
  RunPhase,
  FileChangeSetStatus,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import {
  CANCEL_STOP_ROW,
  PAUSE_STOP_ROW,
} from "../../../domain/agentrun/platform-rows.js";

import {
  INVOKE_AGENT_EXECUTION_WORKFLOW_NAME,
  MEMO_ACTIVITY_TASK_QUEUE,
  SIGNAL_APPROVAL_GATE_RESOLVED,
  SIGNAL_PAUSE,
  SIGNAL_RESUME,
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
  readonly status: AgentRunStatus;
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
    executeCredentials: [],
    subjectArguments: [],
    loadResults: [],
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
  const status = create(AgentRunStatusSchema, {
    phase,
    ...(error !== undefined ? { error } : {}),
  });
  return toJson(AgentRunStatusSchema, status) as Record<string, unknown>;
}

/** An execution snapshot with the given status, as the load activity returns it. */
function executionJson(status: AgentRunStatus): JsonValue {
  return toJson(
    AgentRunSchema,
    create(AgentRunSchema, {
      metadata: { id: currentExecutionId },
      status,
    }),
  );
}

function statusWithPendingApproval(): AgentRunStatus {
  return create(AgentRunStatusSchema, {
    phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
    pendingApprovals: [{ toolCallId: "tc-1", toolName: "echo" }],
  });
}

function statusWithEmptyGate(): AgentRunStatus {
  return create(AgentRunStatusSchema, {
    phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
  });
}

/** A change set already DECIDED (verdicts in) but not yet reconciled. */
function statusDecidedAwaitingReconcile(): AgentRunStatus {
  return create(AgentRunStatusSchema, {
    phase: RunPhase.RUN_WAITING_FOR_APPROVAL,
    fileChangeSets: [
      {
        id: `${currentExecutionId}:1`,
        status: FileChangeSetStatus.DECIDED,
      },
    ],
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
        status: fromJson(AgentRunStatusSchema, statusJson),
      });
    },
    LoadAgentExecution: async (): Promise<JsonValue> => {
      const result =
        script.loadResults.length > 1
          ? script.loadResults.shift()!
          : script.loadResults[0];
      if (result === undefined) {
        throw new Error("test script exhausted: unexpected LoadAgentExecution");
      }
      return result;
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
 * The EC-delete pin, honest to Temporal's contract (oss#892):
 * DeleteExecutionContext is a LOCAL activity, and local activities are
 * at-least-once — a workflow task whose completion fails to commit
 * re-executes them (their markers never landed), so an exactly-once
 * count assertion flakes under CI load while the production delete is
 * idempotent by design. The pin is "fired, and only ever for THIS
 * execution": a duplicate is legal; a foreign id is a test-isolation
 * leak and must fail loudly.
 */
function expectExecutionContextDeleted(): void {
  expect(
    script.deletedExecutionContexts.length,
    "the ExecutionContext delete must fire",
  ).toBeGreaterThanOrEqual(1);
  expect(
    script.deletedExecutionContexts.filter((id) => id !== currentExecutionId),
    "every recorded delete must belong to this test's execution",
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

  it("completes the deep-agent happy path and cleans up the ExecutionContext", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls).toEqual([{ thread_id: "thread-1", turn_seq: 0 }]);
    expectExecutionContextDeleted();
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
    expectExecutionContextDeleted();
  }, 30_000);

  it("re-invokes after approvalGateResolved with TurnSeq = approvalCycle", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.loadResults = [executionJson(statusWithPendingApproval())];

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
    expectExecutionContextDeleted();
  }, 30_000);

  it("re-invokes immediately without a signal when the gate is decided-awaiting-reconcile", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.loadResults = [executionJson(statusDecidedAwaitingReconcile())];

    const handle = await startWorkflow(workflowInput());
    // No signal is ever sent — the reconcile re-invoke must happen alone.
    await handle.result();

    expect(script.executeCalls.map((call) => call.turn_seq)).toEqual([0, 1]);
  }, 30_000);

  it("fails fast after MAX_ZERO_GATE_CYCLES consecutive empty-gate WAITING cycles", async (testCtx) => {    if (!envReady) return testCtx.skip();
    // Every invocation reports WAITING; every load shows an empty gate
    // with nothing awaiting reconcile → 3 tolerated cycles, then fail.
    script.executeBehaviors = Array.from({ length: 8 }, () => async () =>
      slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
    );
    script.loadResults = [executionJson(statusWithEmptyGate())];

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
    // The workflow is the pause row's one writer: the runner cannot tell
    // this stop from a cancel, so it settles without a row.
    expect(
      script.persistedStatuses[pausedAt]!.status.messages.map((m) => [m.type, m.content]),
      "the PAUSED persist carries the pause row",
    ).toEqual([[MessageType.MESSAGE_SYSTEM, PAUSE_STOP_ROW]]);
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

  // NOTE: full recovery EXHAUSTION (11 interrupted invocations, ~275s of
  // real linear backoff) is not exercised here — createLocal does not
  // auto-skip timers the way Go's test env does. The classifier and the
  // honest-copy mapping it feeds are pinned by runner-failure.test.ts;
  // the recovery loop mechanics are pinned by the single-cycle test above.

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
    // The runner already explained its own failure in the transcript, so
    // no FAILED write of the workflow adds a second explanation.
    expect(
      failed.flatMap((entry) => entry.status.messages),
      "a runner-reported failure adds no platform lines",
    ).toEqual([]);
    expectExecutionContextDeleted();
  }, 30_000);

  it("explains a flow that broke without a runner verdict with the platform's two lines", async (testCtx) => {    if (!envReady) return testCtx.skip();
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
    const lines = failed.at(-1)!.status.messages;
    expect(lines.map((m) => m.type)).toEqual([
      MessageType.MESSAGE_SYSTEM,
      MessageType.MESSAGE_SYSTEM,
    ]);
    // The details carry the wrapped activity error (wrapActivityError's
    // operator-actionable prefix), not a runner-authored sentence.
    expect(lines[1]!.content).toMatch(/^Error details: activity 'ExecuteDeepAgent'/);
    expectExecutionContextDeleted();
  }, 30_000);

  it("cancellation persists CANCELLED quietly and still deletes the ExecutionContext (stigmer#282)", async (testCtx) => {    if (!envReady) return testCtx.skip();
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
    // Cancel is a QUIET terminal state: no status.error, the muted
    // system message is the durable marker.
    expect(cancelled.status.error).toBe("");
    expect(cancelled.status.messages.map((message) => message.content)).toEqual([
      CANCEL_STOP_ROW,
    ]);
    expectExecutionContextDeleted();
  }, 60_000);

  it("cursor flow re-reads harness_state_id before each re-invocation", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(RunPhase.RUN_WAITING_FOR_APPROVAL),
      async () => slimResult(RunPhase.RUN_COMPLETED),
    ];
    script.loadResults = [executionJson(statusWithPendingApproval())];
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
    script.loadResults = [executionJson(statusWithPendingApproval())];

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
