/**
 * Invoke-workflow orchestration tests — ports the scenario matrix of
 * pkg/domain/agentexecution/temporal/workflows/invoke_workflow_pause_test.go
 * (TestWorkflowEnvironment with mocked activities and a persisted-status
 * recorder).
 *
 * What these pin (all load-bearing orchestration contracts):
 *   - the happy path (EnsureThread → ExecuteDeepAgent → EC cleanup);
 *   - the HITL loop (WAITING persist → gate re-read → approvalGateResolved
 *     → re-invoke with TurnSeq = approvalCycle — the deterministic
 *     change-set id input);
 *   - the DD-28 decided-awaiting-reconcile immediate re-invoke;
 *   - the zero-gate fail-fast bound (MAX_ZERO_GATE_CYCLES);
 *   - pause/resume (activity cancelled, PAUSED persisted, resume
 *     re-invokes) — Go's CancellationScope pattern;
 *   - bounded auto-recovery on worker-shutdown shapes (#776: IN_PROGRESS
 *     persisted, honest status copy on exhaustion);
 *   - EXECUTION_FAILED propagation with the fallback persist;
 *   - external cancellation cleanup (CANCELLED persisted quietly —
 *     stigmer#282 — and the EC deleted);
 *   - callback-token completion on success AND failure (the DD-001 lane,
 *     oss#861: the TS error completion WORKS);
 *   - the cursor flow's harness_state_id re-read discipline.
 *
 * Follows the runner's golden-e2e precedent: TestWorkflowEnvironment
 * .createLocal (needs the `temporal` CLI on PATH); every test skips
 * gracefully when the local test server cannot start.
 */
import { fromJson, toJson, create } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  FileChangeSetStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

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
// stopped being tested (panel finding).
let envReady = false;

// ─── Scriptable activity doubles ────────────────────────────────────────
// Each test scripts behaviors through this mutable harness; afterEach
// resets it so tests stay order-independent.

interface RecordedStatus {
  readonly executionId: string;
  readonly status: AgentExecutionStatus;
}

interface RecordedCompletion {
  readonly callbackToken: string;
  readonly result?: unknown;
  readonly errorMessage?: string;
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
  /** Consumed per LoadAgentExecution call, in order; last one sticks. */
  loadResults: JsonValue[];
  /** Consumed per ReadHarnessStateId call, in order; last one sticks. */
  harnessStateIds: Array<string | (() => Promise<string>)>;
  persistedStatuses: RecordedStatus[];
  completions: RecordedCompletion[];
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

function resetScript(): void {
  for (const release of script?.releaseBlocked ?? []) {
    release();
  }
  script = {
    executeBehaviors: [],
    executeCalls: [],
    loadResults: [],
    harnessStateIds: [],
    persistedStatuses: [],
    completions: [],
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
      resolve(slimResult(ExecutionPhase.EXECUTION_COMPLETED)),
    );
  });
}

function slimResult(
  phase: ExecutionPhase,
  error?: string,
): Record<string, unknown> {
  const status = create(AgentExecutionStatusSchema, {
    phase,
    ...(error !== undefined ? { error } : {}),
  });
  return toJson(AgentExecutionStatusSchema, status) as Record<string, unknown>;
}

/** An execution snapshot with the given status, as the load activity returns it. */
function executionJson(status: AgentExecutionStatus): JsonValue {
  return toJson(
    AgentExecutionSchema,
    create(AgentExecutionSchema, {
      metadata: { id: "exec-1" },
      status,
    }),
  );
}

function statusWithPendingApproval(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    pendingApprovals: [{ toolCallId: "tc-1", toolName: "echo" }],
  });
}

function statusWithEmptyGate(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
  });
}

/** DD-28: a change set already DECIDED (verdicts in) but not yet reconciled. */
function statusDecidedAwaitingReconcile(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
    fileChangeSets: [
      {
        id: "exec-1:1",
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
  }) => {
    script.executeCalls.push({
      thread_id: input.thread_id,
      turn_seq: input.turn_seq,
    });
    const behavior = script.executeBehaviors.shift();
    if (behavior === undefined) {
      throw new Error("test script exhausted: unexpected agent invocation");
    }
    return behavior(input);
  };

  return {
    EnsureThread: async (): Promise<string> => script.ensureThreadResult,
    GenerateSessionSubject: async (): Promise<void> => {},
    ExecuteDeepAgent: takeExecuteBehavior as never,
    ExecuteCursor: takeExecuteBehavior as never,
    UpdateExecutionStatus: async (
      executionId: string,
      statusJson: JsonValue,
    ): Promise<void> => {
      script.persistedStatuses.push({
        executionId,
        status: fromJson(AgentExecutionStatusSchema, statusJson),
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
    "stigmer/system/complete-external-activity": async (input: {
      callbackToken: string;
      result?: unknown;
      errorMessage?: string;
    }): Promise<void> => {
      script.completions.push(input);
    },
  };
}

// ─── Workflow start helpers ─────────────────────────────────────────────

function workflowInput(
  overrides: Partial<InvokeAgentExecutionWorkflowInput> = {},
): InvokeAgentExecutionWorkflowInput {
  return {
    execution_id: "exec-1",
    session_id: "ses-1",
    agent_id: "agt-1",
    ...overrides,
  };
}

let workflowSeq = 0;

async function startWorkflow(
  input: InvokeAgentExecutionWorkflowInput,
): Promise<import("@temporalio/client").WorkflowHandle> {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  workflowSeq++;
  return env.client.workflow.start(INVOKE_AGENT_EXECUTION_WORKFLOW_NAME, {
    taskQueue: TASK_QUEUE,
    workflowId: `invoke-test-${workflowSeq}-${Date.now()}`,
    args: [input],
    memo: { [MEMO_ACTIVITY_TASK_QUEUE]: TASK_QUEUE },
  });
}

/** Polls the recorder until a status with the given phase lands. */
async function waitForPersistedPhase(
  phase: ExecutionPhase,
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
    `no persisted status reached phase ${ExecutionPhase[phase]} within ${timeoutMs}ms; ` +
      `saw [${script.persistedStatuses.map((entry) => ExecutionPhase[entry.status.phase]).join(", ")}]`,
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

  afterEach(() => {
    resetScript();
  });

  it("completes the deep-agent happy path and cleans up the ExecutionContext", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls).toEqual([{ thread_id: "thread-1", turn_seq: 0 }]);
    expect(script.deletedExecutionContexts).toEqual(["exec-1"]);
    expect(script.completions).toEqual([]);
  }, 30_000);

  it("re-invokes after approvalGateResolved with TurnSeq = approvalCycle", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
      async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
    ];
    script.loadResults = [executionJson(statusWithPendingApproval())];

    const handle = await startWorkflow(workflowInput());
    await waitForPersistedPhase(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
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
          entry.status.phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      ),
    ).toBe(true);
    expect(script.deletedExecutionContexts).toEqual(["exec-1"]);
  }, 30_000);

  it("re-invokes immediately without a signal when the gate is decided-awaiting-reconcile (DD-28)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
      async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
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
      slimResult(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
    );
    script.loadResults = [executionJson(statusWithEmptyGate())];

    const handle = await startWorkflow(workflowInput());
    await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

    // 1 first invoke + 3 tolerated zero-gate re-invokes, then fail-fast.
    expect(script.executeCalls).toHaveLength(4);
    const failed = script.persistedStatuses.filter(
      (entry) => entry.status.phase === ExecutionPhase.EXECUTION_FAILED,
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
        async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
      ];
    });

    const handle = await startWorkflow(workflowInput());
    await firstStarted;
    await handle.signal(SIGNAL_PAUSE, "Paused by user");
    await waitForPersistedPhase(ExecutionPhase.EXECUTION_PAUSED);
    await handle.signal(SIGNAL_RESUME);
    await handle.result();

    expect(script.executeCalls.map((call) => call.turn_seq)).toEqual([0, 0]);
    const phases = script.persistedStatuses.map((entry) => entry.status.phase);
    const pausedAt = phases.indexOf(ExecutionPhase.EXECUTION_PAUSED);
    expect(pausedAt, "the pause branch persists PAUSED").toBeGreaterThanOrEqual(0);
    // The resume path re-asserts IN_PROGRESS AFTER the PAUSED persist —
    // the oss#869 healing write (owner-ratified TS addition): the PAUSED
    // defense persist can land over a fast resume's IN_PROGRESS, and this
    // sequenced write is what guarantees the phase never sticks PAUSED
    // while the resumed turn runs.
    expect(
      phases
        .slice(pausedAt + 1)
        .includes(ExecutionPhase.EXECUTION_IN_PROGRESS),
      "resume re-asserts IN_PROGRESS after the PAUSED persist",
    ).toBe(true);
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
      async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
    ];

    const handle = await startWorkflow(workflowInput());
    await handle.result();

    expect(script.executeCalls).toHaveLength(2);
    expect(
      script.persistedStatuses.some(
        (entry) => entry.status.phase === ExecutionPhase.EXECUTION_IN_PROGRESS,
      ),
    ).toBe(true);
  }, 60_000);

  // NOTE: full recovery EXHAUSTION (11 interrupted invocations, ~275s of
  // real linear backoff) is not exercised here — createLocal does not
  // auto-skip timers the way Go's test env does. The classifier and the
  // honest-copy mapping it feeds are pinned by runner-failure.test.ts;
  // the recovery loop mechanics are pinned by the single-cycle test above.

  it("propagates EXECUTION_FAILED results with the fallback persist", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_FAILED, "agent blew up"),
    ];

    const handle = await startWorkflow(workflowInput());
    await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

    const failed = script.persistedStatuses.filter(
      (entry) => entry.status.phase === ExecutionPhase.EXECUTION_FAILED,
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(failed[0]!.status.error).toBe("agent blew up");
    expect(script.deletedExecutionContexts).toEqual(["exec-1"]);
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

    await waitForPersistedPhase(ExecutionPhase.EXECUTION_CANCELLED);
    const cancelled = script.persistedStatuses.find(
      (entry) => entry.status.phase === ExecutionPhase.EXECUTION_CANCELLED,
    )!;
    // Cancel is a QUIET terminal state: no status.error, the muted
    // system message is the durable marker.
    expect(cancelled.status.error).toBe("");
    expect(cancelled.status.messages.map((message) => message.content)).toEqual([
      "Execution was cancelled.",
    ]);
    expect(script.deletedExecutionContexts).toEqual(["exec-1"]);
  }, 60_000);

  it("completes the callback token with the result on success", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => ({
        ...slimResult(ExecutionPhase.EXECUTION_COMPLETED),
        structuredOutput: { verdict: "ok" },
        final_text: "done",
      }),
    ];
    script.loadResults = [
      toJson(
        AgentExecutionSchema,
        create(AgentExecutionSchema, {
          metadata: { id: "exec-1" },
          status: {
            phase: ExecutionPhase.EXECUTION_COMPLETED,
            streamingUsage: { totalTokens: 1234n, estimatedCostUsd: 0.05 },
          },
        }),
      ),
    ];

    const handle = await startWorkflow(
      workflowInput({ callback_token: Buffer.from("tok-1").toString("base64") }),
    );
    await handle.result();

    expect(script.completions).toHaveLength(1);
    const completion = script.completions[0]!;
    expect(completion.errorMessage).toBeUndefined();
    expect(completion.result).toEqual({
      agent_execution_id: "exec-1",
      structured: { verdict: "ok" },
      final_text: "done",
      // total_tokens is a JSON NUMBER (the cross-component contract; the
      // bigint is converted explicitly).
      usage_summary: { total_tokens: 1234, estimated_cost_usd: 0.05 },
    });
  }, 30_000);

  it("FAILS the workflow when the callback-result load fails (never a wedged task-retry loop)", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
    ];
    // No loadResults scripted: every LoadAgentExecution attempt throws.
    // The success-path boundary must convert the exhausted retries into a
    // FAILED WORKFLOW (Go's `return err`) — a plain-Error rethrow would
    // fail only the workflow TASK, which the server retries forever
    // (panel finding), and handle.result() would hang instead of reject.
    script.loadResults = [];

    const handle = await startWorkflow(
      workflowInput({ callback_token: Buffer.from("tok-load").toString("base64") }),
    );
    // The SDK wraps the workflow's ApplicationFailure in a generic
    // WorkflowFailedError; the pinned load-failure text rides the cause.
    await expect(handle.result()).rejects.toSatisfy((error: unknown) => {
      const cause = (error as { cause?: Error }).cause;
      return /load execution/.test(cause?.message ?? "");
    });
    // Go's success path does NOT complete the callback on a load failure
    // (Run returns the error directly) — the parent times out instead.
    expect(script.completions).toHaveLength(0);
  }, 60_000);

  it("completes the callback token with the error on failure (DD-001 — the lane Go cannot deliver, oss#861)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_FAILED, "agent blew up"),
    ];

    const handle = await startWorkflow(
      workflowInput({ callback_token: Buffer.from("tok-2").toString("base64") }),
    );
    await expect(handle.result()).rejects.toThrow(/Workflow execution failed/);

    expect(script.completions).toHaveLength(1);
    expect(script.completions[0]!.errorMessage).toContain(
      "agent execution failed: agent blew up",
    );
  }, 30_000);

  it("cursor flow re-reads harness_state_id before each re-invocation", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL),
      async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
    ];
    script.loadResults = [executionJson(statusWithPendingApproval())];
    // First read: empty (the activity creates the Cursor agent); the
    // re-invocation read returns the stored agentId for Agent.resume.
    script.harnessStateIds = ["", "cursor-agent-1"];

    const handle = await startWorkflow(
      workflowInput({ harness: Harness.CURSOR }),
    );
    await waitForPersistedPhase(ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL);
    await handle.signal(SIGNAL_APPROVAL_GATE_RESOLVED);
    await handle.result();

    expect(script.executeCalls).toEqual([
      { thread_id: "", turn_seq: 0 },
      { thread_id: "cursor-agent-1", turn_seq: 1 },
    ]);
  }, 30_000);

  it("survives a missing parent workflow for child_execution_started (non-fatal)", async (testCtx) => {    if (!envReady) return testCtx.skip();
    script.executeBehaviors = [
      async () => slimResult(ExecutionPhase.EXECUTION_COMPLETED),
    ];

    const handle = await startWorkflow(
      workflowInput({ parent_workflow_id: "nonexistent-parent" }),
    );
    await handle.result();

    expect(script.executeCalls).toHaveLength(1);
  }, 30_000);
});
