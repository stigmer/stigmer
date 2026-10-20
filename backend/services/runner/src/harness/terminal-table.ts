/**
 * The terminal table: every way a turn ends, as data — the phase it writes,
 * the `error` it sets, the system rows it appends, whether it stamps
 * `completedAt`, and whether the activity RETURNS the slim status or THROWS
 * a `CancelledFailure` — with one function that applies an arm to a status.
 *
 * Why data and not one function per arm: the copy is the user-facing
 * contract of the runner (the hermetic goldens pin every string below byte
 * for byte, `activities/execute-cursor/__tests__/hermetic/`), and a table a
 * reader can scan is how that contract stays reviewable. The native
 * harness once kept one function per arm (`streaming-terminal.ts`, retired
 * in #1096); since #1096 both harnesses' turns end through this one table.
 *
 * The `error` of a FAILED arm is the failure itself, never framed: the
 * `Execution failed:` wording belongs to the rows and to each consumer's
 * own copy (the console's badge, the CLI's epilogue), so a consumer meets
 * one grammar whichever arm wrote it. The interruption arms' `Execution
 * interrupted:` errors are a different outcome, one the user resumes.
 *
 * The throw-vs-return rule, from the orchestrator it replaces, with a third
 * disposition since a drained turn continues (stigmer#2428):
 *  - RETURN when a Temporal retry would only repeat the outcome — a wedged
 *    engine's stall would wedge again, an exhausted budget would burn again, a platform
 *    stop is the platform's decision, a failed engine would fail the same
 *    prompt the same way, a completed turn is complete.
 *  - THROW `CancelledFailure` when the workflow must see the activity as
 *    cancelled — the orchestrator's pause, the runner's drain past its
 *    grace, and an infrastructure cancel it delivered — with the message the
 *    control planes recognise.
 *  - CONTINUE when the turn stopped itself so the workflow runs it on: a
 *    drain the engine yielded to at a step boundary, or a stall that came
 *    while the turn waited on its model (`OpenOperations.awaitingModel`):
 *    the provider's, not the engine's, so the continuation asks the model
 *    again from where the turn was. No cancellation was
 *    delivered, so a thrown `CancelledFailure` would reach the workflow as a
 *    plain failure (Temporal reports one as cancelled only after it asked);
 *    the runtime throws the typed failure {@link TURN_CONTINUES_FAILURE_TYPE}
 *    instead, which the workflow matches by name.
 *
 * An arm the workflow continues writes NO ending: no phase, no error, no
 * completion stamp, no stop cause. The run is still working, and the
 * server's merge keeps a terminal phase for good (a FAILED written here once
 * made the workflow's recovery unable to bring the run back, and the
 * session's log refused the continued turn's events, stigmer#2428). The
 * workflow writes the outcome only when it gives up, as it does for the
 * orchestrator's stop below. Such an arm may append one {@link TerminalArm.note}
 * that tells the user why the turn moved.
 *
 * One stop has no copy here: the orchestrator's (a Pause or a Cancel, which
 * reach the activity as the same workflow-requested cancellation). The turn
 * cannot tell which it is, so its arm writes no phase and no row, and the
 * invoke workflow, which knows, writes the phase and the stop row that the
 * server's merge keeps last (stigmer#980;
 * `backend/services/stigmer-server/src/domain/run/platform-rows.ts`).
 * The pause row lived here until then, and a cancelled run ended with an
 * instruction to resume it. The arm's throw messages keep their bytes: they
 * are the wire copy the control planes see on the activity failure.
 *
 * An arm's rows are appended exactly once, by `applyTerminalArm`, and an arm
 * is persisted exactly once, by `run-turn.ts`'s `settleWith` — the one
 * writer of a terminal. The orchestrator this table replaced appended the
 * three THROW arms' rows twice (its throw fell into its own catch, which
 * wrote the copy again); #1070 reproduced that on purpose so the goldens could
 * pin the wire byte for byte, and the PR after it removed it with a reviewed
 * golden regeneration (stigmer#1054).
 */

import { create } from "@bufbuild/protobuf";
import type { RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { COST_LIMIT_USER_COPY, formatCostLimitError } from "../shared/cost-guard.js";
import { TOOL_CALL_LIMIT_USER_COPY, formatToolCallLimitError } from "../shared/tool-rounds.js";
import { formatStallFailure, type StallTimeoutError } from "../shared/stall-watchdog.js";
import { formatOperationLimitFailure, type OperationLimitError } from "./open-operations.js";
import { utcTimestamp } from "../shared/status.js";
import type { WorkspaceLockTimeoutError } from "../shared/workspace/workspace-lock.js";
import type { FailureSurface } from "./types.js";
import type { MockAbort } from "./stop-controller.js";
import { formatTryStop } from "@stigmer/eval-runtime";
import { AgentMessageSchema, type TurnRows } from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/**
 * Why a turn stopped, as `RunStatus.stop_cause` names it: the one
 * structured cause the session's status reads (`budget_reached`, a typed
 * error), so no reader matches an error's text. Every arm that stops the
 * turn names one; the waiting arm names none (`null`), because a turn that
 * waits has not stopped.
 */
export type StopCause =
  | "budget_reached"
  | "timeout"
  | "infrastructure"
  | "platform_stop"
  | "user"
  | "model_error"
  | "failed"
  | "eval_stopped"
  | "review_resolved";

/**
 * Why a turn stops so that the workflow continues it on the next
 * invocation. Crosses to the workflow as the typed failure's one detail.
 */
export type ContinuationCause = "drain" | "model-stall";

/**
 * The `ApplicationFailure` type a continuing turn throws, which the invoke
 * workflow matches by name (`backend/services/stigmer-server/src/temporal/runner-failure.ts`
 * `TURN_CONTINUES_FAILURE_TYPE`). Wire vocabulary: byte-pinned on both sides.
 */
export const TURN_CONTINUES_FAILURE_TYPE = "StigmerTurnContinues";

/** How the activity ends after the arm is written and persisted. */
export type TerminalDisposition =
  | { readonly kind: "return" }
  | { readonly kind: "throw"; readonly message: string }
  /**
   * `message`: the typed failure's message, which the workflow writes as the
   * run's error if it gives up continuing; the shared copy when absent.
   */
  | { readonly kind: "continue"; readonly cause: ContinuationCause; readonly message?: string };

/** One arm of the table: what to write, and how to end. */
export interface TerminalArm {
  /** `RUN_PHASE_UNSPECIFIED` writes no phase: the merge applies a phase only when one is sent. */
  readonly phase: RunPhase;
  /** `status.error`; absent leaves it as it is (a pause is not an error). */
  readonly error?: string;
  /** System rows appended in order, each exactly once. */
  readonly rows: readonly string[];
  /**
   * One row an arm whose turn continues appends after its rows, saying why
   * the turn moved. Unlike `rows`, the session's log carries it as the
   * harness's note: no status event says this stop, because the run has
   * not stopped.
   */
  readonly note?: string;
  /** Stamp `completedAt`; a paused turn is not complete. */
  readonly completes: boolean;
  /** `status.stop_cause`; `null` for an arm whose turn waits rather than stops. */
  readonly stopCause: StopCause | null;
  readonly disposition: TerminalDisposition;
}

const RETURN: TerminalDisposition = { kind: "return" };

/** The fixed strings of the table, in one place. Every one is pinned by a golden or a hermetic assertion. */
export const TERMINAL_COPY = {
  orchestratorStop: {
    throwMessage: "Activity paused by orchestrator",
    throwMessageAfterError: "Activity paused by orchestrator (error during pause)",
  },
  workerShutdown: {
    throwMessage: "Activity cancelled (worker shutdown, not user pause)",
  },
  infrastructureCancel: {
    throwMessage: "Activity cancelled (heartbeat timeout, not user pause)",
    throwMessageAfterError: "Activity cancelled (infrastructure, not user pause)",
  },
  continuation: {
    /**
     * The typed failure's message when its arm names none. The workflow
     * matches the type and the detail; it writes a message only when it
     * gives up continuing a cause whose own copy is the run's error (a
     * model stall's).
     */
    failureMessage: "The turn continues on the next invocation",
    /** The note a continuing turn leaves, by cause. */
    notes: {
      drain: "The runner is restarting; this turn continues on the next one.",
      "model-stall": "The model stopped answering; this turn continues from where it was.",
    } satisfies Record<ContinuationCause, string>,
    /** The note a continued turn writes itself when its log does not say why it stopped (`turn-context.ts` `stopIsExplained`). */
    lostRunnerNote: "This turn continues after its runner stopped unexpectedly.",
  },
  platformStop: {
    row: "Execution stopped by the platform.",
  },
  fileReview: {
    applyFailedPrefix: "Some approved file changes could not be applied because the file changed after review: ",
    discardedPrefix: "Some proposed file changes were discarded by the user and were not applied: ",
  },
  internalFailure: {
    row: "Internal system error occurred. Please contact support if this issue persists.",
  },
} as const;

// ── The arms ────────────────────────────────────────────────────────────────

/** The watchdog cancelled a turn that made no progress. RETURN: an identical prompt would wedge again. */
export function stallArm(error: StallTimeoutError): TerminalArm {
  return {
    phase: RunPhase.RUN_FAILED,
    error: formatStallFailure(error),
    rows: [
      `Execution failed: the agent made no progress for too long and was stopped (${error.message}). You can retry or resume.`,
    ],
    completes: true,
    stopCause: "timeout",
    disposition: RETURN,
  };
}

/**
 * The runtime's backstop stopped an operation that stayed open past its
 * limit (`open-operations.ts`). FAILED with the stall's stop cause, so no
 * new wire value: both are a turn stopped by the runtime's clock. Its own
 * copy, because the stall's "made no progress" is untrue here: the turn was
 * working, and was stopped at a limit. RETURN: a retry would run the same
 * operation into the same limit.
 */
export function operationLimitArm(error: OperationLimitError): TerminalArm {
  return {
    phase: RunPhase.RUN_FAILED,
    error: formatOperationLimitFailure(error),
    rows: [`Execution failed: ${error.message} and was stopped. You can retry or resume.`],
    completes: true,
    stopCause: "timeout",
    disposition: RETURN,
  };
}

/**
 * A eval-run try's scaffold failed before the engine started.
 * TERMINATED, as the other stops of a try: the platform stopped the run
 * before the agent did anything, and a TERMINATED run keeps the runner's
 * error as written (a FAILED one is reframed by the invoke workflow), so the
 * eval reads the try stop's sentence back (`parseTryStop`) and scores the
 * try 0. RETURN: a retry would run the same script.
 */
export function evalScaffoldFailedArm(message: string): TerminalArm {
  return {
    phase: RunPhase.RUN_TERMINATED,
    error: message,
    rows: [message],
    completes: true,
    stopCause: "eval_stopped",
    disposition: RETURN,
  };
}

/**
 * A eval-run try's mock stopped the turn: its input guard was violated,
 * its agent ended the run, or the agent mocks' call budget ran out.
 * TERMINATED, as the cost cap: the platform stopped the run on purpose. The
 * error is the try stop's sentence (`@stigmer/eval-runtime`
 * `formatTryStop`), which the eval reads back as the try's `aborted`.
 * RETURN: a retry would make the same call.
 */
export function mockAbortArm(abort: MockAbort): TerminalArm {
  return {
    phase: RunPhase.RUN_TERMINATED,
    error: formatTryStop({ kind: "mock-aborted", server: abort.server, tool: abort.tool, reason: abort.reason }),
    rows: [`A mock stopped this run: ${abort.server}.${abort.tool}: ${abort.reason}`],
    completes: true,
    stopCause: "eval_stopped",
    disposition: RETURN,
  };
}

/**
 * The cost cap stopped the turn. TERMINATED, not FAILED: the platform
 * deliberately stopped the run, work is checkpointed, and the conversation
 * continues on the next message (the recursion-limit precedent,
 * {@link toolCallLimitArm}). RETURN: a retry would burn the same budget
 * again.
 */
export function costCapArm(maxCostUsd: number, estimatedCostUsd: number): TerminalArm {
  return {
    phase: RunPhase.RUN_TERMINATED,
    error: formatCostLimitError(maxCostUsd, estimatedCostUsd),
    rows: [COST_LIMIT_USER_COPY],
    completes: true,
    stopCause: "budget_reached",
    disposition: RETURN,
  };
}

/**
 * The engine exhausted its tool-round budget (`max_tool_rounds`). TERMINATED,
 * not FAILED, for the cost cap's reason: the platform deliberately stopped
 * the run, work is checkpointed, and the conversation continues on the next
 * message. RETURN: a retry would spend the same budget again. The error's
 * prefix is a cross-repo contract (`shared/tool-rounds.ts`).
 */
export function toolCallLimitArm(): TerminalArm {
  return {
    phase: RunPhase.RUN_TERMINATED,
    error: formatToolCallLimitError(),
    rows: [TOOL_CALL_LIMIT_USER_COPY],
    completes: true,
    stopCause: "budget_reached",
    disposition: RETURN,
  };
}

/**
 * The runner drained past its grace and Temporal stopped the turn mid-step.
 * Not an ending (the module header): the workflow continues the turn on the
 * next runner, so nothing terminal is written, and the drain's note says
 * why it moved. Thrown as cancelled, with the message the control planes
 * match; on a drain Temporal's core reports the activity as its own
 * `WorkerShutdown` failure, which they match too.
 */
export function workerShutdownArm(): TerminalArm {
  return {
    phase: RunPhase.RUN_PHASE_UNSPECIFIED,
    rows: [],
    note: TERMINAL_COPY.continuation.notes.drain,
    completes: false,
    stopCause: null,
    disposition: { kind: "throw", message: TERMINAL_COPY.workerShutdown.throwMessage },
  };
}

/**
 * The turn stopped so the workflow continues it on the next invocation: the
 * engine yielded at a durable step boundary (a drain, `TurnSink.yieldSignal`)
 * or its model stopped answering ({@link modelStallArm}). Nothing terminal is
 * written; the note says why the turn moved; the typed failure tells the
 * workflow to continue it (the module header).
 */
export function continueArm(cause: ContinuationCause, message?: string): TerminalArm {
  return {
    phase: RunPhase.RUN_PHASE_UNSPECIFIED,
    rows: [],
    note: TERMINAL_COPY.continuation.notes[cause],
    completes: false,
    stopCause: null,
    disposition: { kind: "continue", cause, ...(message !== undefined ? { message } : {}) },
  };
}

/**
 * The watchdog stopped a turn that waited on its model: the provider stopped
 * answering, which a retry from where the turn was can outlast. Nothing
 * terminal is written; the note says why the turn moved; the typed failure
 * carries the stall's own copy, which is the run's error if the workflow
 * gives up (the stall's, so a run that never recovers reads as stalled).
 */
export function modelStallArm(error: StallTimeoutError): TerminalArm {
  return continueArm("model-stall", formatStallFailure(error));
}

/**
 * The orchestrator stopped the turn: a Pause or a Cancel, indistinguishable
 * here (the module header). The transcript is settled and persisted with no
 * phase and no row, because the workflow writes both; not an error, not
 * complete; thrown as cancelled so the workflow sees the activity stop.
 */
export function orchestratorStopArm(): TerminalArm {
  return {
    phase: RunPhase.RUN_PHASE_UNSPECIFIED,
    rows: [],
    completes: false,
    stopCause: "user",
    disposition: { kind: "throw", message: TERMINAL_COPY.orchestratorStop.throwMessage },
  };
}

/**
 * Temporal cancelled for its own reason (a heartbeat timeout): the workflow
 * has already counted the activity lost and continues the turn on a runner
 * that answers. Not an ending (the module header), and no note: this runner
 * may be the one that stopped answering. Thrown as cancelled.
 */
export function infrastructureCancelArm(): TerminalArm {
  return {
    phase: RunPhase.RUN_PHASE_UNSPECIFIED,
    rows: [],
    completes: false,
    stopCause: null,
    disposition: { kind: "throw", message: TERMINAL_COPY.infrastructureCancel.throwMessage },
  };
}

/**
 * The engine proposed at least one gated side effect and stopped: the
 * WAITING_APPROVAL rows are already on the transcript. Not an error, not
 * complete, no copy; RETURN to the workflow, which waits for the approval
 * signal and reinvokes with the decisions. Until #1096 this was an inline
 * phase flip in `run-turn.ts`; it is an arm because every way an activity
 * ends belongs in this one table.
 */
export function awaitingApprovalArm(): TerminalArm {
  return { phase: RunPhase.RUN_WAITING_FOR_APPROVAL, rows: [], completes: false, stopCause: null, disposition: RETURN };
}

/** The control plane answered STOP. A clean COMPLETED early exit. */
export function platformStopArm(): TerminalArm {
  return {
    phase: RunPhase.RUN_COMPLETED,
    rows: [TERMINAL_COPY.platformStop.row],
    completes: true,
    stopCause: "platform_stop",
    disposition: RETURN,
  };
}

/** Another turn held the primary tree past the lock timeout. RETURN: a retry would queue behind the same holder. */
export function workspaceLockTimeoutArm(error: WorkspaceLockTimeoutError): TerminalArm {
  return {
    phase: RunPhase.RUN_FAILED,
    error: error.message,
    rows: [`Execution failed: ${error.message}`],
    completes: true,
    stopCause: "timeout",
    disposition: RETURN,
  };
}

/**
 * A reconcile turn: the run a person's Undo on an ended turn starts. The
 * agent finished that turn long ago, so undoing a change never re-prompts it
 * (Cursor-like); putting the files back is the whole act and the execution
 * is complete. A failed undo (the captured content no longer matched what
 * was reviewed, or the files could not be restored) tells the human; a
 * successful one names the files put back — the agent's native context
 * still believes those edits stuck, and any edit it makes from that belief
 * is offered for review again next turn (the structural safety net). The
 * copy is the table's pinned wire and keeps its bytes.
 */
export function fileReviewResolvedArm(settlement: {
  readonly failed: boolean;
  readonly failureDetail: string;
  readonly discardedPaths: readonly string[];
}): TerminalArm {
  const rows: string[] = [];
  if (settlement.failed) {
    rows.push(`${TERMINAL_COPY.fileReview.applyFailedPrefix}${settlement.failureDetail}.`);
  } else if (settlement.discardedPaths.length > 0) {
    rows.push(`${TERMINAL_COPY.fileReview.discardedPrefix}${settlement.discardedPaths.join(", ")}.`);
  }
  return { phase: RunPhase.RUN_COMPLETED, rows, completes: true, stopCause: "review_resolved", disposition: RETURN };
}

/**
 * The adapter settled `failed`. The surface picks the copy (the three shapes
 * the Cursor orchestrator wrote, `types.ts` `FailureSurface`); `message` is
 * the adapter's user-facing sentence and becomes `status.error` whole.
 */
export function failedArm(message: string, surface: FailureSurface): TerminalArm {
  const rows = ((): readonly string[] => {
    switch (surface) {
      case "engine":
        return [];
      case "actionable":
        return [`Execution failed: ${message}`];
      case "internal":
        return [TERMINAL_COPY.internalFailure.row, `Error details: ${message}`];
      default: {
        const exhaustive: never = surface;
        throw new Error(`terminal table: unknown failure surface ${String(exhaustive)}`);
      }
    }
  })();
  // The engine's own failure is the model provider's (a refused or failed
  // model request); every other surface is a failure of the turn.
  const stopCause: StopCause = surface === "engine" ? "model_error" : "failed";
  return { phase: RunPhase.RUN_FAILED, error: message, rows, completes: true, stopCause, disposition: RETURN };
}

/**
 * An error the runtime caught itself, outside any adapter (a resolution
 * phase, the epilogue): an `internal` failure like any adapter's, described
 * as `[<type>] <message>` (`describeExecutionError` supplies the two parts),
 * so `status.error` reads the same whichever side caught the fault. Until
 * stigmer#1122 this arm alone prefixed `status.error` with `Execution
 * failed:`, and a consumer that adds its own failure copy (the CLI's
 * epilogue) printed the words twice.
 */
export function unexpectedErrorArm(errorType: string, errorMessage: string): TerminalArm {
  return failedArm(`[${errorType}] ${errorMessage}`, "internal");
}

/**
 * Whether a harness note is one of the runtime's continuation notes: the
 * turn moved, and its log already says why. Its own copy, so the match is
 * exact.
 */
export function isContinuationNote(text: string): boolean {
  return text === TERMINAL_COPY.continuation.lostRunnerNote || Object.values(TERMINAL_COPY.continuation.notes).some((note) => note === text);
}

// ── Applying an arm ─────────────────────────────────────────────────────────

/**
 * Append system rows, each with its own timestamp, in order. Module-private
 * on purpose: rows reach the turn's rows only through `applyTerminalArm`, so
 * no caller can append an arm's copy a second time (the shape of
 * stigmer#1054).
 */
function appendSystemRows(rows: Pick<TurnRows, "messages">, contents: readonly string[]): void {
  for (const content of contents) {
    rows.messages.push(create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content, timestamp: utcTimestamp() }));
  }
}

/**
 * Write an arm onto the status (phase, error, completion stamp, stop cause)
 * and its rows and note onto the turn's rows. The caller persists and
 * disposes. Returns the root positions of the rows it appended: they repeat
 * the stop the session's status events and the stop cause already say, so
 * the session event emitter is told never to write them as notes of the
 * harness (`events/emitter.ts`). The note is not among them: it is the
 * harness's note, the one word the log has on a turn that moved.
 */
export function applyTerminalArm(status: RunStatus, rows: Pick<TurnRows, "messages">, arm: TerminalArm): readonly number[] {
  status.phase = arm.phase;
  if (arm.error !== undefined) status.error = arm.error;
  if (arm.completes) status.completedAt = utcTimestamp();
  if (arm.stopCause !== null) status.stopCause = arm.stopCause;
  const first = rows.messages.length;
  appendSystemRows(rows, arm.rows);
  if (arm.note !== undefined) appendSystemRows(rows, [arm.note]);
  return arm.rows.map((_, index) => first + index);
}
