/**
 * Invoke-workflow-execution orchestration tests — ports the scenario
 * matrix of invoke_workflow_impl_test.go against a real
 * TestWorkflowEnvironment with the scriptable stub child
 * (test-workflows.ts) and recorder activities.
 *
 * What these pin (the orchestration contracts):
 *   - the happy path: child completes → orchestrator completes, EC
 *     cleaned up, ZERO orchestrator-side status persists;
 *   - child failure: FAILED persist with the "Workflow execution
 *     failed:" copy, EC cleanup, ApplicationFailure to the caller;
 *   - external cancellation: CANCELLED persisted QUIETLY (no
 *     status.error — stigmer#282) on the non-cancellable cleanup scope,
 *     EC cleaned up;
 *   - pause/resume: PAUSED/IN_PROGRESS persists in order, relays reach
 *     the child in arrival order (the serialized-loop FIFO guarantee);
 *   - relaySignal: the generic envelope reaches the child's
 *     task-specific channel with its payload; a malformed envelope is
 *     ignored without burning a relay.
 *
 * Follows #18's discipline: TestWorkflowEnvironment.createLocal (needs
 * the `temporal` CLI); every test skips VISIBLY when the local test
 * server cannot start — never a vacuous green (panel finding B3).
 */
import { fromJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { WorkflowExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

import {
  INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME,
  MEMO_RUNNER_TASK_QUEUE,
  PAUSE_SIGNAL_NAME,
  RELAY_SIGNAL_CHANNEL_NAME,
  RESUME_SIGNAL_NAME,
  UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME,
} from "../names.js";
import type { InvokeWorkflowExecutionWorkflowInput } from "../workflow-input.js";
import {
  TEST_CUSTOM_SIGNAL,
  TEST_RECORD_CHILD_EVENT_ACTIVITY,
  TEST_RELEASE_SIGNAL,
} from "./test-workflows.js";
import { DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME } from "../../../domain/executioncontext/temporal/delete-execution-context.js";

const TASK_QUEUE = "invoke-wfexec-test";
const WORKFLOWS_PATH = new URL("./test-workflows.ts", import.meta.url).pathname;

type TestWorkflowEnvironment =
  import("@temporalio/testing").TestWorkflowEnvironment;
type Worker = import("@temporalio/worker").Worker;

let env: TestWorkflowEnvironment | null = null;
let worker: Worker | null = null;
let workerRunPromise: Promise<void> | null = null;
let envReady = false;

// ─── Recorders (reset per test; order-independent tests) ────────────────

interface RecordedStatus {
  readonly executionId: string;
  readonly status: WorkflowExecutionStatus;
}

let persistedStatuses: RecordedStatus[] = [];
let deletedExecutionContexts: string[] = [];
let childEvents: string[] = [];

function resetRecorders(): void {
  persistedStatuses = [];
  deletedExecutionContexts = [];
  childEvents = [];
}

function recorderActivities(): Record<string, (...args: never[]) => Promise<unknown>> {
  return {
    [UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME]: async (
      executionId: string,
      statusJson: JsonValue,
    ): Promise<void> => {
      persistedStatuses.push({
        executionId,
        status: fromJson(WorkflowExecutionStatusSchema, statusJson),
      });
    },
    [DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]: async (
      executionId: string,
    ): Promise<void> => {
      deletedExecutionContexts.push(executionId);
    },
    [TEST_RECORD_CHILD_EVENT_ACTIVITY]: async (event: string): Promise<void> => {
      childEvents.push(event);
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

let workflowSeq = 0;

async function startOrchestrator(
  executionId: string,
): Promise<import("@temporalio/client").WorkflowHandle> {
  if (!env) throw new Error("TestWorkflowEnvironment not initialized");
  workflowSeq++;
  const input: InvokeWorkflowExecutionWorkflowInput = {
    execution_id: executionId,
    workflow_instance_id: "wfi-1",
    workflow_id: "wf-1",
    org_id: "org-1",
  };
  return env.client.workflow.start(INVOKE_WORKFLOW_EXECUTION_WORKFLOW_NAME, {
    taskQueue: TASK_QUEUE,
    workflowId: `wfexec-test-${workflowSeq}-${Date.now()}`,
    args: [input],
    memo: { [MEMO_RUNNER_TASK_QUEUE]: TASK_QUEUE },
  });
}

async function waitFor(
  predicate: () => boolean,
  label: string,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `timed out waiting for ${label}; ` +
      `persisted=[${persistedStatuses.map((entry) => ExecutionPhase[entry.status.phase]).join(", ")}] ` +
      `childEvents=[${childEvents.join(", ")}]`,
  );
}

function persistedPhases(): ExecutionPhase[] {
  return persistedStatuses.map((entry) => entry.status.phase);
}

/**
 * Releases a holding stub child THROUGH the orchestrator's relay lane —
 * the orchestrator has no test-release handler of its own; the envelope
 * is exactly how any task-specific signal reaches the child in
 * production (June DD-013).
 */
async function releaseChild(
  handle: import("@temporalio/client").WorkflowHandle,
): Promise<void> {
  await handle.signal(RELAY_SIGNAL_CHANNEL_NAME, {
    signalName: TEST_RELEASE_SIGNAL,
    payload: null,
  });
}

describe("invoke-workflow-execution workflow (TestWorkflowEnvironment)", () => {
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
        activities: recorderActivities(),
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
    resetRecorders();
  });

  it("completes the happy path with EC cleanup and ZERO orchestrator persists", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    const handle = await startOrchestrator("wfe-ok");
    await handle.result();

    expect(deletedExecutionContexts).toEqual(["wfe-ok"]);
    // The runner streams real statuses via gRPC; the orchestrator's own
    // persists exist only for the failure/cancel/pause lanes.
    expect(persistedStatuses).toEqual([]);
  }, 30_000);

  it("persists FAILED with Go's copy, cleans up the EC, and fails with ApplicationFailure", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    const handle = await startOrchestrator("wfe-fail");
    await expect(handle.result()).rejects.toThrowError(
      /Workflow execution failed/,
    );

    expect(persistedPhases()).toEqual([ExecutionPhase.EXECUTION_FAILED]);
    const failed = persistedStatuses[0]!;
    expect(failed.executionId).toBe("wfe-fail");
    // Go: "Workflow execution failed: %s" over the child's error text.
    expect(failed.status.error).toMatch(/^Workflow execution failed: /);
    expect(failed.status.error).toContain("child engine boom");
    expect(deletedExecutionContexts).toEqual(["wfe-fail"]);
  }, 30_000);

  it("cancellation persists a QUIET CANCELLED (no error) and cleans up the EC", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    const handle = await startOrchestrator("wfe-hold-cancel");
    await waitFor(() => childEvents.includes("started"), "child start");

    await handle.cancel();
    await expect(handle.result()).rejects.toThrowError();

    expect(persistedPhases()).toEqual([ExecutionPhase.EXECUTION_CANCELLED]);
    // stigmer#282: a user cancel is a quiet terminal state — display
    // layers key error styling on status.error.
    expect(persistedStatuses[0]!.status.error).toBe("");
    expect(deletedExecutionContexts).toEqual(["wfe-hold-cancel"]);
  }, 30_000);

  it("pause then resume: persists PAUSED/IN_PROGRESS in order and relays reach the child in arrival order", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    const handle = await startOrchestrator("wfe-hold-pr");
    await waitFor(() => childEvents.includes("started"), "child start");

    await handle.signal(PAUSE_SIGNAL_NAME, "take a break");
    await waitFor(
      () => persistedPhases().includes(ExecutionPhase.EXECUTION_PAUSED),
      "PAUSED persist",
    );
    await waitFor(
      () => childEvents.includes("pause:take a break"),
      "pause relay at the child",
    );

    await handle.signal(RESUME_SIGNAL_NAME);
    await waitFor(
      () => persistedPhases().includes(ExecutionPhase.EXECUTION_IN_PROGRESS),
      "IN_PROGRESS persist",
    );
    await waitFor(
      () => childEvents.includes("resume"),
      "resume relay at the child",
    );

    await releaseChild(handle);
    await handle.result();

    // Persist order is the loop's serialization; child order is the FIFO
    // relay guarantee (a resume overtaking its pause would wedge the
    // production child).
    expect(persistedPhases()).toEqual([
      ExecutionPhase.EXECUTION_PAUSED,
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    ]);
    expect(childEvents.filter((event) => event !== "started")).toEqual([
      "pause:take a break",
      "resume",
    ]);
    expect(deletedExecutionContexts).toEqual(["wfe-hold-pr"]);
  }, 30_000);

  it("forwards relaySignal envelopes to the child's task-specific channel with the payload", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    const handle = await startOrchestrator("wfe-hold-relay");
    await waitFor(() => childEvents.includes("started"), "child start");

    await handle.signal(RELAY_SIGNAL_CHANNEL_NAME, {
      signalName: TEST_CUSTOM_SIGNAL,
      payload: { answer: 42 },
    });
    await waitFor(
      () => childEvents.some((event) => event.startsWith("custom:")),
      "relayed custom signal at the child",
    );

    await releaseChild(handle);
    await handle.result();

    expect(childEvents).toContain('custom:{"answer":42}');
    // No status persist rides the relay lane (Go relays without one).
    expect(persistedStatuses).toEqual([]);
  }, 30_000);

  it("ignores a malformed relay envelope without failing the workflow", async (testCtx) => {
    if (!envReady) return testCtx.skip();
    const handle = await startOrchestrator("wfe-hold-badrelay");
    await waitFor(() => childEvents.includes("started"), "child start");

    // No envelope at all — Go zero-values it and fails the relay
    // harmlessly; this port refuses it before burning the relay command.
    await handle.signal(RELAY_SIGNAL_CHANNEL_NAME);

    await releaseChild(handle);
    await handle.result();

    expect(childEvents.filter((event) => event !== "started")).toEqual([]);
    expect(deletedExecutionContexts).toEqual(["wfe-hold-badrelay"]);
  }, 30_000);
});
