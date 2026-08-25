/**
 * The workflow-execution orchestrator workflow — ports
 * pkg/domain/workflowexecution/temporal/workflows/invoke_workflow_impl.go
 * (registered as "stigmer/workflow-execution/invoke"; proven by the
 * workflowexecution execution suites on local-ts-execution and the
 * co-located TestWorkflowEnvironment tests).
 *
 * Orchestration only — the TS unified runner owns the actual CNCF
 * Serverless Workflow engine as the child workflow
 * "stigmer/workflow/execute-from-execution" on the memo-pinned runner
 * queue; the runner reports progressive status via gRPC. This workflow:
 *
 *   1. Installs the signal forwarders (pause, resume, relaySignal).
 *   2. Starts the child (ID "workflow-exec-{executionId}",
 *      ParentClosePolicy REQUEST_CANCEL, MaximumAttempts 1) and awaits it.
 *   3. On failure: FAILED persist (worker-shutdown shapes mapped to the
 *      honest platform-failure copy, #776), EC delete, ApplicationFailure.
 *      On cancellation: CANCELLED persist + EC delete on a
 *      non-cancellable scope (Go's disconnected context). On success:
 *      EC delete.
 *
 * Pause/resume ordering guarantee (D2 §4, Go startSignalHandlers): both
 * signals are processed by ONE serialized loop so their relays to the
 * child can never be reordered — both mutate the same `paused` flag in
 * the child, and a resume overtaking its preceding pause would leave the
 * child blocked forever. Each signal's status persist and relay complete
 * before the next signal is read; pause wins ties when both are buffered
 * in the same workflow task (Go registers pause first on its Selector).
 *
 * v1 semantics only (OD-6): Go's "child-workflow-migration" and
 * "remote-cleanup-stubs" version gates and the legacy ExecuteWorkflow
 * activity path are NOT ported — no Go-era history can replay here. The
 * surviving arms are the child-workflow path and the REGULAR-activity
 * cleanup persists (Go v1 uses remote activities on the failure/cancel
 * paths to dodge a Go-SDK RECORD_MARKER replay bug; the history shape is
 * preserved as contract, the same ruling as agentexecution's port).
 *
 * Status persists are best-effort defense-in-depth: the RPC lifecycle
 * steps persist the same phases synchronously, and the runner streams
 * real statuses via gRPC. NOTE (sub-project DD-002): in Go these persists
 * are silently DEAD — the production worker registers the activity under
 * a derived name the workflow's constant never matches. This port
 * registers and invokes under the one constant name, so the lane works
 * here (disclosed divergence in the safe direction; Go issue filed).
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this file runs in Temporal's
 * deterministic sandbox. Only @temporalio/workflow, @temporalio/common,
 * @bufbuild/protobuf, generated protos, and verified-pure modules may be
 * imported (sub-project 20260824.03 discipline).
 */
import { create, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import { ApplicationFailure, CancelledFailure } from "@temporalio/common";
import {
  CancellationScope,
  condition,
  defineSignal,
  executeChild,
  getExternalWorkflowHandle,
  log,
  ParentClosePolicy,
  proxyActivities,
  proxyLocalActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";

import { WorkflowExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { WorkflowExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";

import { DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME } from "../../../domain/executioncontext/temporal/delete-execution-context.js";
import {
  isWorkerShutdown,
  WORKER_SHUTDOWN_STATUS_ERROR,
} from "../../runner-failure.js";
import {
  CHILD_WORKFLOW_TYPE,
  childWorkflowId,
  DEFAULT_RUNNER_TASK_QUEUE,
  MEMO_RUNNER_TASK_QUEUE,
  PAUSE_SIGNAL_NAME,
  RELAY_SIGNAL_CHANNEL_NAME,
  RESUME_SIGNAL_NAME,
  UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME,
} from "../names.js";
import type {
  InvokeWorkflowExecutionWorkflowInput,
  RelaySignalPayload,
} from "../workflow-input.js";

// ─── Signals (byte-pinned names; see names.ts) ──────────────────────────

const pauseSignal = defineSignal<[string?]>(PAUSE_SIGNAL_NAME);
const resumeSignal = defineSignal<[string?]>(RESUME_SIGNAL_NAME);
const relaySignal = defineSignal<[RelaySignalPayload?]>(
  RELAY_SIGNAL_CHANNEL_NAME,
);

// ─── Activity proxies (options are contract: 30s ScheduleToClose, 3 ─────
// attempts, 2s initial interval — invoke_workflow_impl.go's uniform
// policy for every orchestrator-side persist and the EC delete).

interface StatusActivities {
  [UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME]: (
    executionId: string,
    statusJson: JsonValue,
  ) => Promise<void>;
}

interface CleanupActivities {
  [UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME]: (
    executionId: string,
    statusJson: JsonValue,
  ) => Promise<void>;
  [DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]: (
    executionId: string,
  ) => Promise<void>;
}

/**
 * LOCAL-activity mode: the pause/resume signal handlers' persists (Go
 * updateStatusToPaused/updateStatusToRunning use ExecuteLocalActivity).
 */
const signalPathActivities = proxyLocalActivities<StatusActivities>({
  scheduleToCloseTimeout: "30s",
  retry: { maximumAttempts: 3, initialInterval: "2s" },
});

/**
 * REGULAR-activity mode on this workflow's own (stigmer) queue: the
 * failure/cancellation persists and the EC delete (Go's v1
 * "remote-cleanup-stubs" arm — local-activity RECORD_MARKER events in the
 * same workflow task as a child-workflow failure trigger a Go-SDK state
 * machine bug; the history shape is preserved as contract).
 */
const cleanupActivities = proxyActivities<CleanupActivities>({
  scheduleToCloseTimeout: "30s",
  retry: { maximumAttempts: 3, initialInterval: "2s" },
});

// ─── The workflow ───────────────────────────────────────────────────────

export async function invokeWorkflowExecution(
  input: InvokeWorkflowExecutionWorkflowInput,
): Promise<void> {
  const executionId = input.execution_id;
  log.info("Starting workflow for execution", { executionId });

  // Go reads ctx.Err() to distinguish external workflow cancellation from
  // ordinary failures; the TS equivalent observes the root scope's
  // cancellation request (the dangling rejection is the designed API
  // shape — cancelRequested is a Promise<never>).
  let workflowCancelled = false;
  CancellationScope.current().cancelRequested.catch(() => {
    workflowCancelled = true;
  });

  startSignalForwarders(executionId);

  let childError: unknown;
  try {
    await executeChildWorkflow(input);
  } catch (error) {
    childError = error;
  }

  if (childError !== undefined) {
    // Cancellation path — keyed on the WORKFLOW's cancel state alone
    // (Go temporal.IsCanceledError(ctx.Err())): cleanup runs on a
    // non-cancellable scope and the workflow must end CANCELLED, not
    // FAILED, so the underlying CancelledFailure is what propagates.
    if (workflowCancelled) {
      log.info("Workflow cancelled, running cancellation cleanup", {
        executionId,
      });
      await handleCancellation(executionId);
      throw (
        findInCauseChain(childError, CancelledFailure) ??
        new CancelledFailure("Workflow cancelled")
      );
    }

    log.error("Workflow execution failed", {
      executionId,
      error: errorMessage(childError),
    });

    try {
      await updateStatusOnFailure(executionId, childError);
    } catch (error) {
      // Go logs and proceeds — the EC delete and the workflow's own
      // failure must not be lost to a status-persist failure.
      log.error("Failed to update execution status", {
        error: errorMessage(error),
      });
    }

    await deleteExecutionContext(executionId);

    // Only a TemporalFailure fails a TS workflow — a plain throw fails
    // the workflow TASK, which the server retries forever (the #18 panel
    // finding). Go: temporal.NewApplicationError("Workflow execution
    // failed", "", err).
    throw ApplicationFailure.create({
      message: "Workflow execution failed",
      cause:
        childError instanceof Error
          ? childError
          : new Error(String(childError)),
    });
  }

  log.info(
    "Workflow completed for execution (status updates were sent progressively via gRPC)",
    { executionId },
  );

  await deleteExecutionContext(executionId);
}

// ─── Signal forwarders (Go startSignalHandlers) ─────────────────────────

/**
 * Installs the three signal handlers and starts the two forwarding loops.
 * The loops are fire-and-forget workflow "goroutines": they emit no
 * commands until a signal is actually processed, so the common case (no
 * signal ever received) leaves history untouched. On external workflow
 * cancellation their `condition` waits reject in the cancel activation
 * itself — caught and treated as loop exit, because an uncaught rejection
 * would fail the workflow task at the activation boundary and the server
 * would retry it forever (the #18 monitor lesson; Go's goroutines get
 * this leniency from their SDK for free).
 */
function startSignalForwarders(executionId: string): void {
  // Buffered-channel semantics (Go GetSignalChannel): signals delivered
  // before a handler runs — or while the loop is busy processing an
  // earlier one — queue losslessly.
  const pauseQueue: string[] = [];
  let resumePending = 0;
  const relayQueue: RelaySignalPayload[] = [];

  setHandler(pauseSignal, (reason?: string) => {
    pauseQueue.push(reason ?? "");
  });
  setHandler(resumeSignal, () => {
    resumePending++;
  });
  setHandler(relaySignal, (payload?: RelaySignalPayload) => {
    if (payload === undefined || (payload.signalName ?? "") === "") {
      // Go zero-values a malformed envelope and the empty signal name
      // then fails inside SignalExternalWorkflow's relay (warn-only).
      // Refusing it here reaches the same non-fatal outcome without
      // burning a relay command on a signal that cannot deliver.
      log.warn("Relay signal with empty envelope ignored", { executionId });
      return;
    }
    relayQueue.push(payload);
  });

  // ONE serialized pause/resume loop — the ordering guarantee (see the
  // module header). Pause is checked first each iteration: Go's Selector
  // registers pause first, so it wins ties when both are buffered.
  void (async () => {
    for (;;) {
      try {
        await condition(() => pauseQueue.length > 0 || resumePending > 0);
      } catch {
        return; // External cancellation — stand down.
      }
      if (pauseQueue.length > 0) {
        const reason = pauseQueue.shift() ?? "";
        log.info("Pause signal received", { executionId, reason });
        await persistPhase(
          executionId,
          ExecutionPhase.EXECUTION_PAUSED,
          "Failed to update execution status to PAUSED",
        );
        await relaySignalToChild(executionId, PAUSE_SIGNAL_NAME, reason);
      } else {
        resumePending--;
        log.info("Resume signal received", { executionId });
        await persistPhase(
          executionId,
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          "Failed to update execution status to IN_PROGRESS",
        );
        await relaySignalToChild(executionId, RESUME_SIGNAL_NAME, null);
      }
    }
  })();

  // Generic relay loop (LISTEN / human_input tasks): the API layer
  // signals this orchestrator via SignalWithStart; task-specific signal
  // channels are registered in the child.
  void (async () => {
    for (;;) {
      try {
        await condition(() => relayQueue.length > 0);
      } catch {
        return; // External cancellation — stand down.
      }
      const payload = relayQueue.shift();
      if (payload === undefined) {
        continue;
      }
      log.info("Relay signal received", {
        executionId,
        signal: payload.signalName,
      });
      await relaySignalToChild(
        executionId,
        payload.signalName,
        payload.payload,
      );
    }
  })();
}

/**
 * Forwards a signal to the TS child workflow via SignalExternalWorkflow
 * (Go relaySignalToChild). Best-effort: a missing/completed child is a
 * warning, never a workflow failure. The payload is always sent as one
 * argument — Go sends exactly one (nil for resume), and the child's
 * handlers read the first argument or ignore it.
 */
async function relaySignalToChild(
  executionId: string,
  signalName: string,
  payload: unknown,
): Promise<void> {
  const childId = childWorkflowId(executionId);
  try {
    await getExternalWorkflowHandle(childId).signal(signalName, payload);
  } catch (error) {
    log.warn("Failed to relay signal to child workflow", {
      executionId,
      signal: signalName,
      childWorkflowId: childId,
      error: errorMessage(error),
    });
  }
}

// ─── The child workflow (Go executeChildWorkflow) ───────────────────────

/**
 * Starts the TS unified runner's engine as a Temporal child workflow and
 * awaits its result. The child handles the actual CNCF Serverless
 * Workflow execution and reports progressive status via gRPC.
 */
async function executeChildWorkflow(
  input: InvokeWorkflowExecutionWorkflowInput,
): Promise<void> {
  const executionId = input.execution_id;
  const childId = childWorkflowId(executionId);
  const taskQueue = getRunnerTaskQueue();

  log.info("Starting child workflow", {
    executionId,
    childWorkflowId: childId,
    taskQueue,
  });

  await executeChild(CHILD_WORKFLOW_TYPE, {
    workflowId: childId,
    taskQueue,
    // The parent's close requests cancellation rather than killing the
    // child mid-write; recover's terminate-existing step is the hard
    // stop when an operator needs one.
    parentClosePolicy: ParentClosePolicy.REQUEST_CANCEL,
    // ALL retry semantics live above the child (recover is
    // terminate-and-start-fresh, stigmer#200) — a blind engine re-run
    // would replay side effects the runner already streamed.
    retry: { maximumAttempts: 1 },
    args: [input],
  });
}

/**
 * The dispatch-resolved runner queue, pinned in the workflow memo at
 * creation (workflow_creator.go). The fallback "should never happen if
 * the workflow is created properly" (Go getRunnerTaskQueue). Go's legacy
 * "activityTaskQueue" memo fallback is deliberately not ported — no
 * pre-migration history can replay on this server (OD-6; names.ts).
 */
function getRunnerTaskQueue(): string {
  const memoValue = workflowInfo().memo?.[MEMO_RUNNER_TASK_QUEUE];
  if (typeof memoValue === "string" && memoValue !== "") {
    return memoValue;
  }
  return DEFAULT_RUNNER_TASK_QUEUE;
}

// ─── Status persists ────────────────────────────────────────────────────

/**
 * Phase-only status persist for the pause/resume handlers (Go
 * updateStatusToPaused/updateStatusToRunning): LOCAL activity,
 * best-effort — logs on error, never propagates.
 */
async function persistPhase(
  executionId: string,
  phase: ExecutionPhase,
  warnMessage: string,
): Promise<void> {
  const status = create(WorkflowExecutionStatusSchema, { phase });
  try {
    await signalPathActivities[UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME](
      executionId,
      statusToJson(status),
    );
    log.info("Updated execution status", {
      executionId,
      phase: ExecutionPhase[phase],
    });
  } catch (error) {
    log.warn(warnMessage, { executionId, error: errorMessage(error) });
  }
}

/**
 * FAILED persist on the system-error path (Go updateStatusOnFailure):
 * REGULAR activity. Recognized worker-shutdown shapes persist the honest
 * platform-failure copy instead of raw Temporal drain internals (#776) —
 * the raw text stays in the workflow log (the caller already logged it).
 * Unlike the other persists this one PROPAGATES its error (Go returns it
 * for the caller's log line).
 */
async function updateStatusOnFailure(
  executionId: string,
  originalError: unknown,
): Promise<void> {
  log.info("Updating execution status to FAILED", { executionId });

  // The child's real error hides in the failure's CAUSE chain (the TS
  // SDK's ChildWorkflowFailure.message is the generic "Child Workflow
  // execution failed"); Go's %s renders the whole chain, so the persisted
  // copy joins it too — status.error is the operator's only view of WHY.
  const statusError = isWorkerShutdown(originalError)
    ? WORKER_SHUTDOWN_STATUS_ERROR
    : `Workflow execution failed: ${errorChainMessage(originalError)}`;

  const failedStatus = create(WorkflowExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: statusError,
  });

  await cleanupActivities[UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME](
    executionId,
    statusToJson(failedStatus),
  );
  log.info("Updated execution status to FAILED", { executionId });
}

/**
 * Cancellation cleanup on a non-cancellable scope (Go's disconnected
 * context): both operations are best-effort and independent — the
 * execution must reach CANCELLED and the ExecutionContext (secrets) must
 * be cleaned up regardless.
 */
async function handleCancellation(executionId: string): Promise<void> {
  await CancellationScope.nonCancellable(async () => {
    await updateStatusOnCancellation(executionId);
    await deleteExecutionContext(executionId);
  });
}

/**
 * CANCELLED persist (Go updateStatusOnCancellation): REGULAR activity,
 * best-effort. Deliberately sets NO status.error — a user-initiated
 * cancel is a quiet terminal state, not a failure (stigmer#282); display
 * layers key error styling on status.error, so a sentinel here would
 * render the stop as a failure. The CANCELLED phase alone carries the
 * state.
 */
async function updateStatusOnCancellation(executionId: string): Promise<void> {
  const cancelledStatus = create(WorkflowExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_CANCELLED,
  });
  try {
    await cleanupActivities[UPDATE_WORKFLOW_EXECUTION_STATUS_ACTIVITY_NAME](
      executionId,
      statusToJson(cancelledStatus),
    );
    log.info("Updated execution status to CANCELLED", { executionId });
  } catch (error) {
    log.warn("Failed to update execution status to CANCELLED", {
      executionId,
      error: errorMessage(error),
    });
  }
}

/**
 * Deletes the ephemeral ExecutionContext (the fully-merged environment,
 * including secrets) on a non-cancellable scope so cleanup runs on every
 * exit path, cancellation included (Go's disconnected context). REGULAR
 * activity (Go's v1 arm — agentexecution's Go uses a local activity here;
 * this domain's Go does not, and the port follows ITS source). Errors are
 * logged, never propagated.
 */
async function deleteExecutionContext(executionId: string): Promise<void> {
  await CancellationScope.nonCancellable(async () => {
    try {
      await cleanupActivities[DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME](
        executionId,
      );
      log.info("ExecutionContext cleaned up", { executionId });
    } catch (error) {
      log.warn("ExecutionContext cleanup failed (will rely on TTL backup)", {
        executionId,
        error: errorMessage(error),
      });
    }
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Statuses cross the activity payload boundary as proto-JSON — the TS
 * default payload converter cannot serialize typed messages' bigint
 * int64 fields (sub-project 20260824.03 design rule). Server-internal:
 * this worker's workflow is the only caller.
 */
function statusToJson(status: WorkflowExecutionStatus): JsonValue {
  return toJson(WorkflowExecutionStatusSchema, status);
}

function findInCauseChain<T extends Error>(
  error: unknown,
  ctor: new (...args: never[]) => T,
): T | undefined {
  for (
    let e: unknown = error;
    e instanceof Error;
    e = (e as { cause?: unknown }).cause
  ) {
    if (e instanceof ctor) {
      return e;
    }
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Joins the failure's message chain (Go's `%s` on a wrapped error renders
 * every layer): "Child Workflow execution failed: child engine boom".
 * Used for the persisted user-facing copy; logs keep the top message.
 */
function errorChainMessage(error: unknown): string {
  const messages: string[] = [];
  for (
    let e: unknown = error;
    e instanceof Error;
    e = (e as { cause?: unknown }).cause
  ) {
    if (e.message !== "") {
      messages.push(e.message);
    }
  }
  return messages.length > 0 ? messages.join(": ") : String(error);
}
