/**
 * The agent-execution orchestrator workflow — ports
 * pkg/domain/agentexecution/temporal/workflows/invoke_workflow_impl.go
 * (registered as "stigmer/agent-execution/invoke"; proven by the
 * agentexecution execution suites on local-execution and the
 * co-located TestWorkflowEnvironment tests).
 *
 * Orchestration only — the TS unified runner owns the agent activities
 * (EnsureThread/ExecuteDeepAgent/ExecuteCursor) on the memo-pinned
 * activity queue; this workflow's own activities run on the stigmer
 * queue or in-process (local activities).
 *
 * Shape preserved exactly from Go:
 *   - Harness dispatch: NATIVE/UNSPECIFIED → deep-agent flow
 *     (EnsureThread once, thread stable across re-invocations), CURSOR →
 *     cursor flow (harness_state_id re-read before every re-invocation).
 *   - Pause/resume: each attempt runs in a cancellable scope with a
 *     monitor that consumes ONE pause signal and cancels the scope; a
 *     pause queued while no attempt is running pauses the next attempt
 *     immediately (Go's buffered signal channel semantics).
 *   - HITL loop: while the runner reports WAITING_FOR_APPROVAL, persist
 *     the phase, re-read the unified gate from the DB, and either wait
 *     for approvalGateResolved, re-invoke immediately (decided-awaiting-
 *     reconcile, DD-28 auto-keep race), or fail fast after
 *     MAX_ZERO_GATE_CYCLES empty-gate cycles.
 *   - Bounded auto-recovery: heartbeat-timeout / infra-cancellation /
 *     worker-shutdown (#776) interruptions re-invoke from persisted
 *     checkpoint state with linear backoff, IN_PROGRESS persisted so the
 *     UI never flashes FAILED.
 *   - Cancellation cleanup on a non-cancellable scope (Go's disconnected
 *     context): CANCELLED persist (quiet terminal, NO status.error —
 *     stigmer#282), callback completion with "execution cancelled", EC
 *     delete.
 *   - Recovery is terminate-and-start-fresh ONLY (stigmer#200); no
 *     version gates (OD-6 — no Go-era history can replay here).
 *
 * Payload-boundary rule (sub-project 20260824.03 design rule): proto
 * Message instances never cross activity payloads — statuses travel as
 * proto-JSON (toJson/fromJson), int64 fields are converted explicitly
 * where the callback contract requires JSON numbers.
 *
 * WORKFLOW-BUNDLE IMPORT DISCIPLINE: this file runs in Temporal's
 * deterministic sandbox. Only @temporalio/workflow, @temporalio/common,
 * @bufbuild/protobuf, generated protos, and verified-pure domain modules
 * (filereview/gate.js by DIRECT path — its sibling digest.ts pulls
 * node:crypto) may be imported. The SDK bundler hard-fails otherwise.
 */
import { create, fromJson, toJson } from "@bufbuild/protobuf";
import type { JsonValue } from "@bufbuild/protobuf";
import {
  ApplicationFailure,
  CancelledFailure,
  TimeoutFailure,
  TimeoutType,
} from "@temporalio/common";
import {
  CancellationScope,
  condition,
  defineSignal,
  getExternalWorkflowHandle,
  isCancellation,
  log,
  proxyActivities,
  proxyLocalActivities,
  setHandler,
  sleep,
  workflowInfo,
} from "@temporalio/workflow";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import {
  hasDecidedAwaitingReconcile,
  unresolvedGateCount,
} from "../../../domain/agentexecution/filereview/gate.js";
import {
  isWorkerShutdown,
  WORKER_SHUTDOWN_STATUS_ERROR,
} from "../../runner-failure.js";
import {
  COMPLETE_EXTERNAL_ACTIVITY_NAME,
  DEFAULT_ACTIVITY_TASK_QUEUE,
  ENSURE_THREAD_ACTIVITY_NAME,
  EXECUTE_CURSOR_ACTIVITY_NAME,
  EXECUTE_DEEP_AGENT_ACTIVITY_NAME,
  GENERATE_SESSION_SUBJECT_ACTIVITY_NAME,
  LOAD_AGENT_EXECUTION_ACTIVITY_NAME,
  MEMO_ACTIVITY_TASK_QUEUE,
  READ_HARNESS_STATE_ID_ACTIVITY_NAME,
  SIGNAL_APPROVAL_GATE_RESOLVED,
  SIGNAL_CHILD_APPROVAL_REQUIRED,
  SIGNAL_CHILD_EXECUTION_STARTED,
  SIGNAL_PAUSE,
  SIGNAL_RESUME,
  UPDATE_EXECUTION_STATUS_ACTIVITY_NAME,
} from "../names.js";
import {
  getErrorFromResult,
  getPhaseFromResult,
  type RunnerActivityResult,
} from "../runner-result.js";
import type { InvokeAgentExecutionWorkflowInput } from "../workflow-input.js";
import { DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME } from "../../../domain/executioncontext/temporal/delete-execution-context.js";

// ─── Loop-safety bounds (invoke_workflow_impl.go, values are contract) ──

/** Maximum HITL approval iterations — prevents infinite loops. */
const MAX_APPROVAL_CYCLES = 100;

/**
 * Bounds consecutive HITL cycles tolerated with phase=WAITING_FOR_APPROVAL
 * but an EMPTY unified gate and nothing owed a reconcile. Once the
 * runner↔backend finalize contract holds this state is unreachable; if it
 * occurs the workflow fails fast rather than tight-looping the full agent
 * activity to MAX_APPROVAL_CYCLES (the production "RUNNING↔WAITING"
 * churn). The small tolerance absorbs a transient read race between the
 * runner's WAITING persist and this workflow's DB read.
 */
const MAX_ZERO_GATE_CYCLES = 3;

/** Maximum pause/resume cycles — prevents infinite loops. */
const MAX_PAUSE_CYCLES = 100;

/**
 * Bounds auto-resume attempts for interrupted activities (worker died /
 * machine slept / worker shut down mid-run, #776) before surfacing the
 * failure. Mirrors the other caps as a loop-safety bound.
 */
const MAX_RECOVERY_CYCLES = 10;

/**
 * Delay before re-invoking an interrupted activity: a short, capped,
 * LINEAR backoff (n×5s, max 60s) gives a worker time to reappear (e.g.
 * the user reopening the session re-adds it) without hot-looping; the
 * activity's own ScheduleToStart timeout (5m) bounds the wait for that
 * worker.
 */
function recoveryBackoffMs(cycle: number): number {
  return Math.min(cycle * 5_000, 60_000);
}

// ─── Signals (byte-pinned names; see names.ts) ──────────────────────────

const pauseSignal = defineSignal<[string?]>(SIGNAL_PAUSE);
const resumeSignal = defineSignal(SIGNAL_RESUME);
const approvalGateResolvedSignal = defineSignal(SIGNAL_APPROVAL_GATE_RESOLVED);

// ─── Activity proxies (options are contract; see the census table) ──────

interface RunnerActivities {
  [ENSURE_THREAD_ACTIVITY_NAME]: (
    sessionId: string,
    agentId: string,
  ) => Promise<string>;
  [EXECUTE_DEEP_AGENT_ACTIVITY_NAME]: (input: {
    execution_id: string;
    thread_id: string;
    invoker_identity_account_id: string;
    turn_seq: number;
  }) => Promise<RunnerActivityResult | null>;
  [EXECUTE_CURSOR_ACTIVITY_NAME]: (input: {
    execution_id: string;
    thread_id: string;
    invoker_identity_account_id: string;
    turn_seq: number;
  }) => Promise<RunnerActivityResult | null>;
  [GENERATE_SESSION_SUBJECT_ACTIVITY_NAME]: (
    executionId: string,
  ) => Promise<void>;
}

function newEnsureThreadProxy(taskQueue: string) {
  return proxyActivities<Pick<RunnerActivities, typeof ENSURE_THREAD_ACTIVITY_NAME>>({
    taskQueue,
    startToCloseTimeout: "30s",
    scheduleToStartTimeout: "5m",
    retry: {
      maximumAttempts: 3,
      initialInterval: "5s",
      backoffCoefficient: 2.0,
    },
  });
}

/**
 * The long-running agent turn: 24h StartToClose (a turn can legitimately
 * run for hours), 2m heartbeat (worker-death detection), and
 * MaximumAttempts 1 — ALL retry semantics live in the workflow's own
 * bounded recovery loop, never in Temporal's retry policy (a blind retry
 * would re-run a turn whose side effects already streamed to the user).
 */
function newExecuteAgentProxy(taskQueue: string) {
  return proxyActivities<
    Pick<
      RunnerActivities,
      | typeof EXECUTE_DEEP_AGENT_ACTIVITY_NAME
      | typeof EXECUTE_CURSOR_ACTIVITY_NAME
    >
  >({
    taskQueue,
    startToCloseTimeout: "24h",
    scheduleToStartTimeout: "5m",
    heartbeatTimeout: "2m",
    retry: {
      maximumAttempts: 1,
      initialInterval: "10s",
      backoffCoefficient: 2.0,
    },
  });
}

/** Best-effort, fire-and-forget (issue #665) — never retried. */
function newSubjectProxy(taskQueue: string) {
  return proxyActivities<
    Pick<RunnerActivities, typeof GENERATE_SESSION_SUBJECT_ACTIVITY_NAME>
  >({
    taskQueue,
    startToCloseTimeout: "60s",
    scheduleToStartTimeout: "30s",
    retry: { maximumAttempts: 1 },
  });
}

interface ServerActivities {
  [UPDATE_EXECUTION_STATUS_ACTIVITY_NAME]: (
    executionId: string,
    statusJson: JsonValue,
  ) => Promise<void>;
  [COMPLETE_EXTERNAL_ACTIVITY_NAME]: (input: {
    callbackToken: string;
    result?: unknown;
    errorMessage?: string;
  }) => Promise<void>;
}

/**
 * Status persists on the FAILURE and CANCELLATION paths run as REGULAR
 * activities on the workflow's own (stigmer) queue: local activities
 * produce RECORD_MARKER events that trigger a Go-SDK state-machine bug
 * when executed in the same workflow task as a remote-activity failure.
 * The history SHAPE is preserved as contract in this port (ratified
 * brief #2, sub-project 20260824.03) — recovery semantics were tuned
 * against it.
 */
const failurePathActivities = proxyActivities<
  Pick<ServerActivities, typeof UPDATE_EXECUTION_STATUS_ACTIVITY_NAME>
>({
  startToCloseTimeout: "30s",
  retry: { maximumAttempts: 3, initialInterval: "2s" },
});

/** The async activity completion lane (token handshake ADR). */
const completionActivities = proxyActivities<
  Pick<ServerActivities, typeof COMPLETE_EXTERNAL_ACTIVITY_NAME>
>({
  startToCloseTimeout: "1m",
  retry: { maximumAttempts: 3, initialInterval: "1s" },
});

interface LocalActivities {
  [UPDATE_EXECUTION_STATUS_ACTIVITY_NAME]: (
    executionId: string,
    statusJson: JsonValue,
  ) => Promise<void>;
  [LOAD_AGENT_EXECUTION_ACTIVITY_NAME]: (
    executionId: string,
  ) => Promise<JsonValue>;
  [READ_HARNESS_STATE_ID_ACTIVITY_NAME]: (sessionId: string) => Promise<string>;
  [DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME]: (
    executionId: string,
  ) => Promise<void>;
}

const localActivities = proxyLocalActivities<LocalActivities>({
  scheduleToCloseTimeout: "30s",
  retry: { maximumAttempts: 3, initialInterval: "2s" },
});

// ─── The workflow ───────────────────────────────────────────────────────

export async function invokeAgentExecution(
  input: InvokeAgentExecutionWorkflowInput,
): Promise<void> {
  const executionId = input.execution_id;
  log.info("Starting workflow for execution", { executionId });

  const callbackToken = input.callback_token ?? "";
  if (callbackToken !== "") {
    log.info("Callback token detected - will complete external activity on finish", {
      executionId,
      tokenLength: callbackToken.length,
    });
  }

  // Go reads ctx.Err() to distinguish external workflow cancellation from
  // internal pause-scope cancels; the TS equivalent observes the root
  // scope's cancellation request. The dangling rejection is the designed
  // API shape (cancelRequested is a Promise<never>).
  let workflowCancelled = false;
  CancellationScope.current().cancelRequested.catch(() => {
    workflowCancelled = true;
  });

  const signals = installSignalBuffers();

  // Notify the parent workflow that the child execution started (enables
  // live subscription). Fire-and-forget: a completed/missing parent must
  // never affect this run.
  if ((input.parent_workflow_id ?? "") !== "") {
    const parentWorkflowId = input.parent_workflow_id!;
    void (async () => {
      try {
        await getExternalWorkflowHandle(parentWorkflowId).signal(
          SIGNAL_CHILD_EXECUTION_STARTED,
          { executionId },
        );
      } catch (error) {
        log.warn("Failed to signal parent execution started (non-fatal)", {
          parentWorkflowId,
          error: errorMessage(error),
        });
      }
    })();
  }

  const activityTaskQueue = getActivityTaskQueue();

  let flowError: unknown;
  let lastActivityResult: RunnerActivityResult | undefined;
  try {
    if ((input.harness ?? 0) === Harness.CURSOR) {
      lastActivityResult = await executeCursorFlow(
        input,
        activityTaskQueue,
        signals,
        () => workflowCancelled,
      );
    } else {
      lastActivityResult = await executeDeepAgentFlow(
        input,
        activityTaskQueue,
        signals,
        () => workflowCancelled,
      );
    }
  } catch (error) {
    flowError = error;
  }

  if (flowError !== undefined) {
    // Cancellation path — keyed on the WORKFLOW's cancel state alone
    // (Go's temporal.IsCanceledError(ctx.Err())): the flow wraps activity
    // errors, so the flowError itself may not read as a cancellation.
    // Cleanup runs on a non-cancellable scope (Go's disconnected context)
    // and the workflow must end CANCELLED, not FAILED — so the underlying
    // CancelledFailure is what propagates (Go's `return err` reaches the
    // same terminal state through its SDK's canceled-error detection).
    if (workflowCancelled) {
      log.info("Workflow cancelled, running cancellation cleanup", { executionId });
      await handleCancellation(executionId, callbackToken);
      throw (
        findInCauseChain(flowError, CancelledFailure) ??
        new CancelledFailure("Workflow cancelled")
      );
    }

    log.error("Workflow execution failed", {
      executionId,
      error: errorMessage(flowError),
    });

    try {
      await updateStatusOnFailure(executionId, flowError);
    } catch (error) {
      log.error("Failed to update execution status", {
        error: errorMessage(error),
      });
    }

    if (callbackToken !== "") {
      try {
        await completionActivities[COMPLETE_EXTERNAL_ACTIVITY_NAME]({
          callbackToken,
          errorMessage: errorMessage(flowError),
        });
      } catch (error) {
        log.error("Failed to complete external activity with error", {
          error: errorMessage(error),
        });
      }
    }

    await deleteExecutionContext(executionId);
    throw ApplicationFailure.create({
      message: "Workflow execution failed",
      cause: flowError instanceof Error ? flowError : new Error(String(flowError)),
    });
  }

  log.info(
    "Workflow completed for execution (status updates were sent progressively via gRPC)",
    { executionId },
  );

  if (callbackToken !== "") {
    // The whole callback sequence shares one error boundary: a throw here
    // must FAIL the workflow (Go's `return err`), and in the TS SDK only
    // a TemporalFailure does that — a plain Error would fail the workflow
    // TASK, which the server retries forever (panel finding: the workflow
    // would wedge instead of failing, and the parent's external activity
    // would never complete). External cancellation mid-sequence takes the
    // cancellation-cleanup path exactly like a mid-flow cancel.
    try {
      let execution: AgentExecution;
      try {
        execution = await loadExecution(executionId);
      } catch (error) {
        log.error("Failed to load execution for callback result", {
          error: errorMessage(error),
        });
        throw error;
      }

      const callbackResult = buildCallbackResult(lastActivityResult, execution);
      try {
        await completionActivities[COMPLETE_EXTERNAL_ACTIVITY_NAME]({
          callbackToken,
          result: callbackResult,
        });
      } catch (error) {
        log.error("Failed to complete external activity with success", {
          error: errorMessage(error),
        });
        throw error;
      }
    } catch (error) {
      if (workflowCancelled) {
        log.info("Workflow cancelled during callback completion, running cancellation cleanup", {
          executionId,
        });
        await handleCancellation(executionId, callbackToken);
        throw (
          findInCauseChain(error, CancelledFailure) ??
          new CancelledFailure("Workflow cancelled")
        );
      }
      throw error instanceof ApplicationFailure
        ? error
        : ApplicationFailure.create({
            message: errorMessage(error),
            cause: error instanceof Error ? error : new Error(String(error)),
          });
    }
  }

  await deleteExecutionContext(executionId);
}

// ─── Signal buffering (Go's buffered signal channels) ───────────────────

interface SignalBuffers {
  /** Pending pause reasons; each monitor consumes exactly one. */
  readonly pauseQueue: string[];
  consumeResume(): Promise<void>;
  consumeApprovalGateResolved(): Promise<void>;
}

function installSignalBuffers(): SignalBuffers {
  const pauseQueue: string[] = [];
  let resumePending = 0;
  let approvalPending = 0;
  setHandler(pauseSignal, (reason?: string) => {
    pauseQueue.push(reason ?? "");
  });
  setHandler(resumeSignal, () => {
    resumePending++;
  });
  setHandler(approvalGateResolvedSignal, () => {
    approvalPending++;
  });
  return {
    pauseQueue,
    async consumeResume() {
      await condition(() => resumePending > 0);
      resumePending--;
    },
    async consumeApprovalGateResolved() {
      await condition(() => approvalPending > 0);
      approvalPending--;
    },
  };
}

// ─── The two harness flows ──────────────────────────────────────────────

/**
 * Native deep-agent flow: EnsureThread ONCE (the LangGraph thread is the
 * checkpoint identity — stable across pause/recovery re-invocations),
 * then the shared pause/recovery loop around the HITL loop.
 */
async function executeDeepAgentFlow(
  input: InvokeAgentExecutionWorkflowInput,
  activityTaskQueue: string,
  signals: SignalBuffers,
  isWorkflowCancelled: () => boolean,
): Promise<RunnerActivityResult> {
  const executionId = input.execution_id;
  const sessionId = input.session_id;
  const invoker = input.invoker_identity_account_id ?? "";

  log.info("Step 1: Ensuring thread", { sessionId, agentId: input.agent_id });
  const ensureThread = newEnsureThreadProxy(activityTaskQueue);
  let threadId: string;
  try {
    threadId = await ensureThread[ENSURE_THREAD_ACTIVITY_NAME](
      sessionId,
      input.agent_id,
    );
  } catch (error) {
    throw wrapActivityError("EnsureThread", error);
  }
  log.info("Thread ensured", { threadId });

  fireGenerateSessionSubject(activityTaskQueue, executionId);

  log.info("Step 2: Executing deep agent", { executionId, threadId });
  const agentProxy = newExecuteAgentProxy(activityTaskQueue);

  return runWithPauseAndRecovery({
    executionId,
    activityLabel: "ExecuteDeepAgent",
    signals,
    isWorkflowCancelled,
    executeWithHitl: () =>
      executeWithHitlLoop({
        executionId,
        signals,
        parentWorkflowId: input.parent_workflow_id ?? "",
        firstInvoke: () =>
          agentProxy[EXECUTE_DEEP_AGENT_ACTIVITY_NAME]({
            execution_id: executionId,
            thread_id: threadId,
            invoker_identity_account_id: invoker,
            turn_seq: 0,
          }),
        // The LangGraph thread id is stable — re-invocations reuse it.
        reinvoke: (turnSeq) =>
          agentProxy[EXECUTE_DEEP_AGENT_ACTIVITY_NAME]({
            execution_id: executionId,
            thread_id: threadId,
            invoker_identity_account_id: invoker,
            turn_seq: turnSeq,
          }),
        nullResultMessage: "activity returned null status - this should never happen",
        nullResultAfterApprovalMessage:
          "activity returned null status after approval - this should never happen",
      }),
  });
}

/**
 * Cursor flow: structurally the deep-agent flow with two variation points
 * (invoke_workflow_impl.go executeCursorFlow) — harness_state_id comes
 * from ReadHarnessStateId instead of EnsureThread (non-fatal on the first
 * read, FATAL before each HITL re-invocation: by then the id must exist,
 * Cursor's Agent.resume needs it), and ExecuteCursor instead of
 * ExecuteDeepAgent.
 */
async function executeCursorFlow(
  input: InvokeAgentExecutionWorkflowInput,
  activityTaskQueue: string,
  signals: SignalBuffers,
  isWorkflowCancelled: () => boolean,
): Promise<RunnerActivityResult> {
  const executionId = input.execution_id;
  const sessionId = input.session_id;
  const invoker = input.invoker_identity_account_id ?? "";

  fireGenerateSessionSubject(activityTaskQueue, executionId);

  log.info("Executing Cursor agent", { executionId, sessionId });
  const agentProxy = newExecuteAgentProxy(activityTaskQueue);

  return runWithPauseAndRecovery({
    executionId,
    activityLabel: "ExecuteCursor",
    signals,
    isWorkflowCancelled,
    executeWithHitl: () =>
      executeWithHitlLoop({
        executionId,
        signals,
        parentWorkflowId: input.parent_workflow_id ?? "",
        firstInvoke: async () => {
          let harnessStateId: string;
          try {
            harnessStateId = await readHarnessStateId(sessionId);
          } catch (error) {
            log.warn(
              "Failed to read session harness_state_id (non-fatal, using empty)",
              { sessionId, error: errorMessage(error) },
            );
            harnessStateId = "";
          }
          return agentProxy[EXECUTE_CURSOR_ACTIVITY_NAME]({
            execution_id: executionId,
            thread_id: harnessStateId,
            invoker_identity_account_id: invoker,
            turn_seq: 0,
          });
        },
        reinvoke: async (turnSeq) => {
          let harnessStateId: string;
          try {
            harnessStateId = await readHarnessStateId(sessionId);
          } catch (error) {
            throw new Error(
              `failed to read session harness_state_id for reinvocation: ${errorMessage(error)}`,
              { cause: error },
            );
          }
          log.info("Re-invoking Cursor after approval", {
            executionId,
            cycle: turnSeq,
            harnessStateId,
          });
          return agentProxy[EXECUTE_CURSOR_ACTIVITY_NAME]({
            execution_id: executionId,
            thread_id: harnessStateId,
            invoker_identity_account_id: invoker,
            turn_seq: turnSeq,
          });
        },
        nullResultMessage:
          "cursor activity returned null status - this should never happen",
        nullResultAfterApprovalMessage:
          "cursor activity returned null status after approval - this should never happen",
      }),
  });
}

/** GenerateSessionSubject: fire-and-forget, non-blocking (issue #665). */
function fireGenerateSessionSubject(
  activityTaskQueue: string,
  executionId: string,
): void {
  const subjectProxy = newSubjectProxy(activityTaskQueue);
  void (async () => {
    try {
      await subjectProxy[GENERATE_SESSION_SUBJECT_ACTIVITY_NAME](executionId);
    } catch (error) {
      log.warn("Session subject generation failed (non-critical)", {
        executionId,
        error: errorMessage(error),
      });
    }
  })();
}

// ─── The shared pause/recovery loop ─────────────────────────────────────

interface PauseRecoveryOptions {
  readonly executionId: string;
  readonly activityLabel: "ExecuteDeepAgent" | "ExecuteCursor";
  readonly signals: SignalBuffers;
  readonly isWorkflowCancelled: () => boolean;
  readonly executeWithHitl: () => Promise<RunnerActivityResult>;
}

/**
 * The outer loop both flows share (byte-identical in Go, parameterized
 * here): each attempt runs the HITL loop in a cancellable scope with a
 * pause monitor; pause → persist PAUSED, wait for resume, re-invoke;
 * recoverable interruption → persist IN_PROGRESS, linear backoff,
 * re-invoke; anything else → wrapped failure. On completion, an
 * EXECUTION_FAILED result persists the fallback FAILED status and
 * propagates as an error.
 */
async function runWithPauseAndRecovery(
  options: PauseRecoveryOptions,
): Promise<RunnerActivityResult> {
  const { executionId, activityLabel, signals, isWorkflowCancelled } = options;

  let finalResult: RunnerActivityResult;
  let pauseCycle = 0;
  let recoveryCycle = 0;

  for (;;) {
    const attempt = await runPausableAttempt(
      executionId,
      signals,
      options.executeWithHitl,
    );

    if (attempt.error !== undefined && attempt.pauseRequested) {
      // Activity (or HITL wait) was cancelled FOR PAUSE — the checkpoint
      // is saved; block on resume, then re-invoke from it.
      pauseCycle++;
      if (pauseCycle > MAX_PAUSE_CYCLES) {
        log.error("Max pause cycles reached", { executionId, cycles: pauseCycle });
        throw new Error(
          `max pause cycles (${MAX_PAUSE_CYCLES}) reached - possible infinite loop`,
        );
      }

      log.info("Execution paused — checkpoint saved, waiting for resume signal", {
        executionId,
        pauseCycle,
      });

      // Defense-in-depth: the Pause RPC already set PAUSED in the DB, but
      // this also folds the latest messages/tool_calls from the
      // activity's final gRPC update.
      await persistFinalStatus(
        executionId,
        create(AgentExecutionStatusSchema, {
          phase: ExecutionPhase.EXECUTION_PAUSED,
        }),
        "Failed to persist PAUSED status (non-fatal)",
      );

      await signals.consumeResume();
      log.info("Resume signal received — restarting activity from checkpoint", {
        executionId,
        pauseCycle,
      });
      // Re-assert IN_PROGRESS after resume (TS-side divergence in the
      // correct direction, owner-ratified; oss#869 tracks the shared
      // root cause). The PAUSED persist above carries no ordering
      // information: on a fast pause→resume it can land AFTER the Resume
      // RPC's IN_PROGRESS write and resurrect PAUSED — and no later
      // writer exists until the turn's terminal persist, so the
      // execution SHOWS paused while running. Because this workflow's
      // writes are sequential (the PAUSED persist completed before the
      // resume wait), this write always lands after the stale one and
      // heals it — the same defense idiom as persistInterruptedStatus.
      await persistResumedStatus(executionId);
      continue;
    }

    if (attempt.error !== undefined) {
      // Transient interruption: auto-resume from the persisted checkpoint
      // instead of dead-ending. Guarded on the workflow NOT being
      // cancelled so external cancellation is never swallowed.
      if (!isWorkflowCancelled() && isRecoverableActivityError(attempt.error)) {
        recoveryCycle++;
        if (recoveryCycle > MAX_RECOVERY_CYCLES) {
          log.error("Max recovery cycles reached, surfacing failure", {
            executionId,
            cycles: recoveryCycle,
          });
          throw wrapActivityError(activityLabel, attempt.error);
        }
        log.warn("Execution interrupted (recoverable), resuming from checkpoint", {
          executionId,
          recoveryCycle,
          error: errorMessage(attempt.error),
        });
        await persistInterruptedStatus(executionId);
        try {
          await sleep(recoveryBackoffMs(recoveryCycle));
        } catch {
          // Sleep only rejects on cancellation — surface the ORIGINAL
          // interruption, exactly Go's sleepErr branch.
          throw wrapActivityError(activityLabel, attempt.error);
        }
        continue;
      }
      throw wrapActivityError(activityLabel, attempt.error);
    }

    finalResult = attempt.result!;
    break;
  }

  const finalPhase = getPhaseFromResult(finalResult);
  log.info("Agent execution completed - final slim status received", {
    executionId,
    phase: ExecutionPhase[finalPhase],
    pauseCycles: pauseCycle,
  });

  if (finalPhase === ExecutionPhase.EXECUTION_FAILED) {
    const finalError = getErrorFromResult(finalResult);
    log.warn("Activity returned EXECUTION_FAILED -- propagating to parent workflow", {
      executionId,
      error: finalError,
    });
    await persistFinalStatus(
      executionId,
      create(AgentExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_FAILED,
        error: finalError,
      }),
      "Failed to persist fallback FAILED status",
    );
    throw new Error(`agent execution failed: ${finalError}`);
  }

  return finalResult;
}

interface AttemptOutcome {
  readonly result?: RunnerActivityResult;
  readonly error?: unknown;
  readonly pauseRequested: boolean;
}

/**
 * One cancellable attempt with a pause monitor (Go's per-iteration
 * workflow.WithCancel + monitoring goroutine): the monitor consumes ONE
 * queued pause signal and cancels the scope — cancelling both the
 * running activity AND any HITL approval wait inside it. If the attempt
 * finishes first, the monitor is released WITHOUT consuming, so a pause
 * that raced completion stays queued for the next attempt (Go's buffered
 * channel semantics).
 */
async function runPausableAttempt(
  executionId: string,
  signals: SignalBuffers,
  execute: () => Promise<RunnerActivityResult>,
): Promise<AttemptOutcome> {
  let pauseRequested = false;
  let attemptDone = false;
  const scope = new CancellationScope();

  const monitor = (async () => {
    try {
      await condition(() => signals.pauseQueue.length > 0 || attemptDone);
    } catch {
      // EXTERNAL workflow cancellation rejects this condition in the
      // cancel activation itself, while the attempt's activity await
      // rejects only in a LATER activation (after the server processes
      // the cancel request). An uncaught rejection here would fail the
      // workflow task at the activation boundary and the server would
      // retry it forever — the TS sandbox has no Go-goroutine leniency.
      // The attempt's own rejection carries the cancellation signal.
      return;
    }
    if (!attemptDone && signals.pauseQueue.length > 0) {
      const reason = signals.pauseQueue.shift() ?? "";
      log.info("Pause signal received", { executionId, reason });
      pauseRequested = true;
      scope.cancel();
    }
  })();

  let result: RunnerActivityResult | undefined;
  let error: unknown;
  try {
    result = await scope.run(execute);
  } catch (e) {
    error = e;
  }
  attemptDone = true;
  await monitor;

  return error !== undefined
    ? { error, pauseRequested }
    : { result, pauseRequested };
}

// ─── The HITL loop ──────────────────────────────────────────────────────

interface HitlLoopOptions {
  readonly executionId: string;
  readonly signals: SignalBuffers;
  /**
   * The workflow input's parent_workflow_id ("" when invoked directly) —
   * the HITL loop notifies this parent whenever the gate engages (D4 #23,
   * DD-012). The loop cannot read the workflow input itself, so the flows
   * thread it through.
   */
  readonly parentWorkflowId: string;
  readonly firstInvoke: () => Promise<RunnerActivityResult | null>;
  readonly reinvoke: (turnSeq: number) => Promise<RunnerActivityResult | null>;
  readonly nullResultMessage: string;
  readonly nullResultAfterApprovalMessage: string;
}

/**
 * Notify the parent workflow that this child is gated — the OSS sender half
 * of the DD-012 child-approval forwarding contract (D4 #23, parity-plus:
 * cloud's InvokeAgentExecutionWorkflowImpl.notifyParentWorkflowOfApproval;
 * Go OSS never sends it). Identity-only BARE-STRING payload — the parent
 * (the runner's call-agent orchestrator) derives the gate from this
 * execution's persisted pending_approvals, so approval details never travel
 * through the signal (see SIGNAL_CHILD_APPROVAL_REQUIRED in names.ts).
 *
 * Fire-and-forget with the same posture as child_execution_started: a
 * completed/missing parent must never affect this run — the user can still
 * approve directly through AgentExecution.submitApproval.
 */
function signalParentApprovalRequired(
  parentWorkflowId: string,
  executionId: string,
  loadedStatus: AgentExecutionStatus | undefined,
): void {
  if (parentWorkflowId === "") {
    // Invoked directly (API/CLI/schedule) — no parent to notify.
    return;
  }

  const pendingApprovals = loadedStatus?.pendingApprovals ?? [];
  log.info("Notifying parent workflow of approval requirement", {
    parentWorkflowId,
    executionId,
    pendingCount: pendingApprovals.length,
    firstToolName: pendingApprovals[0]?.toolName ?? "unknown",
  });

  void (async () => {
    try {
      await getExternalWorkflowHandle(parentWorkflowId).signal(
        SIGNAL_CHILD_APPROVAL_REQUIRED,
        executionId,
      );
    } catch (error) {
      log.warn("Failed to notify parent workflow of approval (non-fatal)", {
        parentWorkflowId,
        error: errorMessage(error),
      });
    }
  })();
}

/**
 * Runs the agent activity and re-invokes it while the runner reports
 * WAITING_FOR_APPROVAL. The gate is UNIFIED: pending approvals AND change
 * sets awaiting review — a turn blocked purely on file review must wait
 * for, and resume from, the same approvalGateResolved signal. TurnSeq is
 * the approvalCycle: the runner mints the deterministic change-set id
 * `executionId:turnSeq` from it, so ledger authoring stays idempotent
 * across Temporal retries.
 */
async function executeWithHitlLoop(
  options: HitlLoopOptions,
): Promise<RunnerActivityResult> {
  const { executionId, signals } = options;

  let result = await options.firstInvoke();
  if (result === null || result === undefined) {
    log.error("Agent activity returned NULL status", { executionId });
    throw new Error(options.nullResultMessage);
  }

  let phase = getPhaseFromResult(result);
  log.info("Activity returned slim status", {
    executionId,
    phase: ExecutionPhase[phase],
  });

  let approvalCycle = 0;
  let zeroGateCycles = 0;
  while (phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL) {
    approvalCycle++;
    if (approvalCycle > MAX_APPROVAL_CYCLES) {
      log.error("Max approval cycles reached", { executionId, cycles: approvalCycle });
      throw new Error(
        `max approval cycles (${MAX_APPROVAL_CYCLES}) reached - possible infinite loop`,
      );
    }

    await persistFinalStatus(
      executionId,
      create(AgentExecutionStatusSchema, {
        phase: ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL,
      }),
      "Failed to persist WAITING_FOR_APPROVAL status before signal wait (non-fatal)",
    );

    // Re-read the unified gate from the system of record; a load failure
    // defaults to 1 (wait for the signal — failing open would re-invoke
    // against an undecided gate).
    let gateCount: number;
    let loadedStatus: AgentExecutionStatus | undefined;
    try {
      const execution = await loadExecution(executionId);
      loadedStatus = execution.status;
      gateCount = unresolvedGateCount(
        execution.status ?? create(AgentExecutionStatusSchema),
      );
    } catch (error) {
      log.warn(
        "Failed to load execution from DB for gate count (non-fatal, will wait for signal)",
        { executionId, error: errorMessage(error) },
      );
      loadedStatus = undefined;
      gateCount = 1;
    }

    log.info("Execution waiting at HITL gate — waiting for approvalGateResolved signal", {
      executionId,
      cycle: approvalCycle,
      gateCount,
    });

    // Cloud parity (both Java HITL loops call notifyParentWorkflowOfApproval
    // here): the parent is notified on EVERY cycle — after the phase persist
    // and gate re-read, BEFORE the gate-count branch — including zero-gate
    // and file-review-only cycles. The runner derives from the persisted
    // gate, so an empty derivation is a harmless "already resolved" no-op.
    signalParentApprovalRequired(options.parentWorkflowId, executionId, loadedStatus);

    if (gateCount === 0) {
      if (loadedStatus !== undefined && hasDecidedAwaitingReconcile(loadedStatus)) {
        // LEGITIMATE empty gate: a change set was decided before this
        // check — the DD-28 approved-command auto-keep authors its
        // decision in the same write that folds the candidate (and a
        // fast human decision can race the check the same way). The
        // runner is owed a reconcile; re-invoke immediately without
        // waiting for a signal that already fired or will never come.
        zeroGateCycles = 0;
        log.info(
          "HITL gate resolved before wait (policy auto-keep or early decision) — re-invoking to reconcile",
          { executionId, cycle: approvalCycle },
        );
      } else {
        // WAITING_FOR_APPROVAL with an empty unified gate and NOTHING
        // owed a reconcile is an inconsistency the finalize contract
        // should make impossible. Tolerate a few consecutive occurrences
        // (transient read race) then fail fast, rather than tight-looping
        // the full activity to MAX_APPROVAL_CYCLES.
        zeroGateCycles++;
        if (zeroGateCycles > MAX_ZERO_GATE_CYCLES) {
          log.error(
            "WAITING_FOR_APPROVAL with empty HITL gate across consecutive cycles — failing fast to avoid a tight re-invocation loop",
            { executionId, cycle: approvalCycle, zeroGateCycles },
          );
          throw new Error(
            `execution stuck in WAITING_FOR_APPROVAL with an empty HITL gate after ${zeroGateCycles} consecutive cycles - gate propagation is broken`,
          );
        }
        log.warn(
          "HITL gate is empty but phase is WAITING_FOR_APPROVAL — re-invoking (bounded) to resolve inconsistency",
          { executionId, cycle: approvalCycle, zeroGateCycles },
        );
      }
    } else {
      zeroGateCycles = 0;
      await signals.consumeApprovalGateResolved();
      log.info("Received approvalGateResolved signal", {
        executionId,
        cycle: approvalCycle,
      });
    }

    log.info("Re-invoking agent after HITL gate resolved", {
      executionId,
      cycle: approvalCycle,
    });

    result = await options.reinvoke(approvalCycle);
    if (result === null || result === undefined) {
      log.error("Agent activity returned NULL status after approval", { executionId });
      throw new Error(options.nullResultAfterApprovalMessage);
    }

    phase = getPhaseFromResult(result);
    log.info("Activity returned slim status after approval", {
      executionId,
      phase: ExecutionPhase[phase],
      cycle: approvalCycle,
    });
  }

  return result;
}

// ─── Failure/cancellation cleanup ───────────────────────────────────────

/**
 * FAILED persist on the system-error path. The worker-shutdown shapes
 * persist the honest platform-failure copy instead of raw Temporal
 * internals ("Worker is shutting down and this activity did not complete
 * in time" reached users in the 2026-08-08 incident, #776) — the raw text
 * stays in the workflow log; status.error is a user surface.
 */
async function updateStatusOnFailure(
  executionId: string,
  originalError: unknown,
): Promise<void> {
  log.info("Updating execution status to FAILED", { executionId });

  const statusError = isWorkerShutdown(originalError)
    ? WORKER_SHUTDOWN_STATUS_ERROR
    : errorMessage(originalError);

  const failedStatus = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: statusError,
    messages: [
      {
        type: MessageType.MESSAGE_SYSTEM,
        content:
          "Internal system error occurred during execution. Please contact support if this issue persists.",
      },
      {
        type: MessageType.MESSAGE_SYSTEM,
        content: `Error details: ${statusError}`,
      },
    ],
  });

  await failurePathActivities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME](
    executionId,
    toJson(AgentExecutionStatusSchema, failedStatus),
  );
  log.info("Updated execution status to FAILED", { executionId });
}

/**
 * Cancellation cleanup on a non-cancellable scope (Go's disconnected
 * context): every operation is best-effort and independent — the
 * execution must reach CANCELLED and secrets (ExecutionContext) must be
 * cleaned up regardless.
 */
async function handleCancellation(
  executionId: string,
  callbackToken: string,
): Promise<void> {
  await CancellationScope.nonCancellable(async () => {
    await updateStatusOnCancellation(executionId);

    if (callbackToken !== "") {
      try {
        await completionActivities[COMPLETE_EXTERNAL_ACTIVITY_NAME]({
          callbackToken,
          errorMessage: "execution cancelled",
        });
      } catch (error) {
        log.warn("Failed to notify parent of cancellation (best-effort)", {
          executionId,
          error: errorMessage(error),
        });
      }
    }

    await deleteExecutionContext(executionId);
  });
}

/**
 * CANCELLED persist. Deliberately sets NO status.error: a user-initiated
 * cancel is a quiet terminal state, not a failure (stigmer#282) — display
 * layers key error styling on phase, so a sentinel here would render the
 * stop as a red failure. The muted MESSAGE_SYSTEM line is the durable
 * in-transcript marker. Regular activity for the same replay-safety
 * reasons as updateStatusOnFailure.
 */
async function updateStatusOnCancellation(executionId: string): Promise<void> {
  const cancelledStatus = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_CANCELLED,
    messages: [
      {
        type: MessageType.MESSAGE_SYSTEM,
        content: "Execution was cancelled.",
      },
    ],
  });

  try {
    await failurePathActivities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME](
      executionId,
      toJson(AgentExecutionStatusSchema, cancelledStatus),
    );
    log.info("Updated execution status to CANCELLED", { executionId });
  } catch (error) {
    log.warn("Failed to update execution status to CANCELLED", {
      executionId,
      error: errorMessage(error),
    });
  }
}

// ─── Local-activity helpers ─────────────────────────────────────────────

/**
 * Fallback status persist (LOCAL activity — the regular/local split is
 * brief #2's contract): safe to call when the runner already persisted
 * via gRPC — the merge is idempotent for identical data.
 */
async function persistFinalStatus(
  executionId: string,
  status: AgentExecutionStatus,
  warnMessage: string,
): Promise<void> {
  try {
    await localActivities[UPDATE_EXECUTION_STATUS_ACTIVITY_NAME](
      executionId,
      toJson(AgentExecutionStatusSchema, status),
    );
    log.info("Persisted final status via fallback", {
      executionId,
      phase: ExecutionPhase[status.phase],
    });
  } catch (error) {
    log.warn(warnMessage, { executionId, error: errorMessage(error) });
  }
}

/**
 * Overwrites any transient FAILED the interrupted activity may have
 * written with IN_PROGRESS, so the UI shows the execution as resuming
 * rather than flashing failed while the workflow re-invokes. Phase-only
 * (no appended message) to stay idempotent across recovery cycles.
 */
async function persistInterruptedStatus(executionId: string): Promise<void> {
  await persistFinalStatus(
    executionId,
    create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    }),
    "Failed to persist interrupted/resuming status (non-fatal)",
  );
}

/**
 * Re-asserts IN_PROGRESS after a resume, healing the stale-PAUSED write
 * the pause branch's defense persist can land over a fast resume's
 * IN_PROGRESS (oss#869 — the race is shared with Go; this correcting
 * write is a TS-side addition in the safe direction, owner-ratified,
 * mirroring persistInterruptedStatus's idiom). Phase-only and idempotent
 * across pause cycles; best-effort like every defense persist.
 */
async function persistResumedStatus(executionId: string): Promise<void> {
  await persistFinalStatus(
    executionId,
    create(AgentExecutionStatusSchema, {
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    }),
    "Failed to persist resumed status (non-fatal)",
  );
}

/**
 * Loads the CURRENT execution from the system of record (the workflow's
 * input snapshot is stale by completion time). Proto-JSON at the payload
 * boundary; parsed to the typed message here.
 */
async function loadExecution(executionId: string): Promise<AgentExecution> {
  let raw: JsonValue;
  try {
    raw = await localActivities[LOAD_AGENT_EXECUTION_ACTIVITY_NAME](executionId);
  } catch (error) {
    throw new Error(`load execution ${executionId}: ${errorMessage(error)}`, {
      cause: error,
    });
  }
  return fromJson(AgentExecutionSchema, raw);
}

async function readHarnessStateId(sessionId: string): Promise<string> {
  try {
    return await localActivities[READ_HARNESS_STATE_ID_ACTIVITY_NAME](sessionId);
  } catch (error) {
    throw new Error(
      `read session harness_state_id for ${sessionId}: ${errorMessage(error)}`,
      { cause: error },
    );
  }
}

/**
 * Deletes the ephemeral ExecutionContext (fully-merged environment incl.
 * secrets) on a non-cancellable scope so cleanup runs even after
 * cancellation. Best-effort; the delete activity itself never throws on
 * missing contexts (#15's seam).
 */
async function deleteExecutionContext(executionId: string): Promise<void> {
  await CancellationScope.nonCancellable(async () => {
    try {
      await localActivities[DELETE_EXECUTION_CONTEXT_ACTIVITY_NAME](executionId);
      log.info("ExecutionContext cleaned up", { executionId });
    } catch (error) {
      log.warn("ExecutionContext cleanup failed (will rely on TTL backup)", {
        executionId,
        error: errorMessage(error),
      });
    }
  });
}

// ─── Callback result and error classification ───────────────────────────

/**
 * The result handed to the parent's external activity (the runner's
 * agent_call). Keys and value SHAPES are a cross-component contract:
 * total_tokens is a JSON NUMBER (Go writes int64 as a number; proto-ES
 * renders int64 as bigint, converted explicitly). Structured output
 * passes through from the runner's extraction with a persisted-status
 * fallback; the three key spellings are historical resilience.
 */
function buildCallbackResult(
  activityResult: RunnerActivityResult | undefined,
  execution: AgentExecution,
): Record<string, unknown> {
  const result: Record<string, unknown> = {
    agent_execution_id: execution.metadata?.id ?? "",
  };

  // The runner's result is untyped JSON; a primitive would crash the `in`
  // checks below (getPhaseFromResult's tolerant posture, extended here).
  if (
    activityResult !== undefined &&
    typeof activityResult === "object" &&
    activityResult !== null
  ) {
    if ("structuredOutput" in activityResult) {
      result["structured"] = activityResult["structuredOutput"];
    } else if ("structured_output" in activityResult) {
      result["structured"] = activityResult["structured_output"];
    } else if ("structured" in activityResult) {
      result["structured"] = activityResult["structured"];
    }
    if ("final_text" in activityResult) {
      result["final_text"] = activityResult["final_text"];
    }
  }

  if (!("structured" in result)) {
    // protobuf-es represents google.protobuf.Struct fields as plain
    // JsonObject — already the JSON shape Go's AsMap() produces.
    const structuredOutput = execution.status?.structuredOutput;
    if (structuredOutput !== undefined) {
      result["structured"] = structuredOutput;
    }
  }

  const streamingUsage = execution.status?.streamingUsage;
  if (streamingUsage !== undefined) {
    result["usage_summary"] = {
      total_tokens: Number(streamingUsage.totalTokens),
      estimated_cost_usd: streamingUsage.estimatedCostUsd,
    };
  }

  return result;
}

/**
 * Whether an activity error is a transient interruption the execution can
 * resume from (re-invoking re-reads the harness_state_id / LangGraph
 * checkpoint), as opposed to a genuine failure.
 *
 * Recoverable: a HEARTBEAT timeout (the worker stopped heartbeating
 * because it crashed, slept, or was reaped mid-run), an infrastructure
 * cancellation that is NOT a user pause (the pause branch handles those)
 * and NOT an external workflow cancellation (the caller guards on the
 * workflow-cancelled flag), and a worker-shutdown drain (#776 owner
 * ruling). NOT recoverable: SCHEDULE_TO_START / START_TO_CLOSE timeouts
 * and application errors — re-invoking those would not change the
 * outcome.
 */
function isRecoverableActivityError(error: unknown): boolean {
  const timeout = findInCauseChain(error, TimeoutFailure);
  if (timeout !== undefined) {
    return timeout.timeoutType === TimeoutType.HEARTBEAT;
  }
  return isCancellation(error) || isWorkerShutdown(error);
}

/**
 * Wraps activity errors with operator-actionable context (Go
 * wrapActivityError). The prefix copy is OURS and byte-pinned from Go;
 * the "Original error:" tail carries the SDK-authored failure text,
 * which necessarily differs between the Go and TS SDKs (disclosed in the
 * sub-project's parity register).
 */
function wrapActivityError(activityName: string, error: unknown): Error {
  const original = errorMessage(error);
  const timeout = findInCauseChain(error, TimeoutFailure);
  if (timeout !== undefined) {
    switch (timeout.timeoutType) {
      case TimeoutType.SCHEDULE_TO_START:
        return new Error(
          `activity '${activityName}' failed: No worker available to execute activity. ` +
            "This usually means:\n" +
            "1. the Stigmer runner is not running\n" +
            "2. the runner failed to start (check runner logs for startup errors)\n" +
            "3. the runner is not connected to Temporal\n" +
            `Original error: ${original}`,
          { cause: error },
        );
      case TimeoutType.HEARTBEAT:
        return new Error(
          `activity '${activityName}' failed: Activity stopped sending heartbeat (worker may have crashed). ` +
            "Check runner logs for errors. " +
            `Original error: ${original}`,
          { cause: error },
        );
      case TimeoutType.START_TO_CLOSE:
        return new Error(
          `activity '${activityName}' failed: Activity execution timed out. ` +
            "The activity started but did not complete within the timeout period. " +
            "Check runner logs for details. " +
            `Original error: ${original}`,
          { cause: error },
        );
      default:
        return new Error(
          `activity '${activityName}' failed with timeout (type: ${goTimeoutTypeName(timeout.timeoutType)}). ` +
            "Check runner logs for details. " +
            `Original error: ${original}`,
          { cause: error },
        );
    }
  }

  if (findInCauseChain(error, ApplicationFailure) !== undefined) {
    return new Error(
      `activity '${activityName}' failed with application error: ${original}. ` +
        "Check runner logs for detailed error information.",
      { cause: error },
    );
  }

  return new Error(
    `activity '${activityName}' failed: ${original}. ` +
      "Check runner logs for details. " +
      `Original error: ${original}`,
    { cause: error },
  );
}

/**
 * Renders a timeout type with Go's enum String() spelling
 * ("ScheduleToClose", not the TS SDK's "SCHEDULE_TO_CLOSE") so the
 * wrapped copy stays byte-comparable across editions. Only the default
 * branch of wrapActivityError reaches this (no proxy configures a
 * ScheduleToClose timeout today).
 */
function goTimeoutTypeName(timeoutType: TimeoutType | undefined): string {
  switch (timeoutType) {
    case TimeoutType.START_TO_CLOSE:
      return "StartToClose";
    case TimeoutType.SCHEDULE_TO_START:
      return "ScheduleToStart";
    case TimeoutType.SCHEDULE_TO_CLOSE:
      return "ScheduleToClose";
    case TimeoutType.HEARTBEAT:
      return "Heartbeat";
    default:
      return "Unspecified";
  }
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

/**
 * The dispatch-resolved activity queue, pinned in the workflow memo at
 * creation (workflow_creator.go). The fallback "should never happen if
 * the workflow is created properly" (Go getActivityTaskQueue).
 */
function getActivityTaskQueue(): string {
  const memoValue = workflowInfo().memo?.[MEMO_ACTIVITY_TASK_QUEUE];
  if (typeof memoValue === "string" && memoValue !== "") {
    return memoValue;
  }
  return DEFAULT_ACTIVITY_TASK_QUEUE;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
