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
 * harness's `execute-deep-agent/streaming-terminal.ts` keeps one function
 * per arm; S3 aligns the two (P-1's copy alignment) with both in view.
 *
 * The throw-vs-return rule, unchanged from the orchestrator it replaces:
 *  - RETURN when a Temporal retry would only repeat the outcome — a stall
 *    would wedge again, an exhausted budget would burn again, a platform
 *    stop is the platform's decision, a failed engine would fail the same
 *    prompt the same way, a completed turn is complete.
 *  - THROW `CancelledFailure` when the workflow must see the activity as
 *    cancelled — the orchestrator's pause, the runner's own drain, and an
 *    infrastructure cancel it delivered — with the message the control
 *    planes recognise.
 *
 * An arm's rows are appended exactly once, by `applyTerminalArm`, and an arm
 * is persisted exactly once, by `run-turn.ts`'s `settleWith` — the one
 * writer of a terminal. The orchestrator this table replaced appended the
 * three THROW arms' rows twice (its throw fell into its own catch, which
 * wrote the copy again); S2 reproduced that on purpose so the goldens could
 * pin the wire byte for byte, and the PR after S2 removed it with a reviewed
 * golden regeneration (stigmer#1054, Q-S2-4).
 */

import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { ExecutionPhase, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { COST_LIMIT_USER_COPY, formatCostLimitError } from "../shared/cost-guard.js";
import { formatStallFailure, type StallTimeoutError } from "../shared/stall-watchdog.js";
import { utcTimestamp } from "../shared/status.js";
import type { WorkspaceLockTimeoutError } from "../shared/workspace/workspace-lock.js";
import type { FailureSurface } from "./types.js";

/** How the activity ends after the arm is written and persisted. */
export type TerminalDisposition = { readonly kind: "return" } | { readonly kind: "throw"; readonly message: string };

/** One arm of the table: what to write, and how to end. */
export interface TerminalArm {
  readonly phase: ExecutionPhase;
  /** `status.error`; absent leaves it as it is (a pause is not an error). */
  readonly error?: string;
  /** System rows appended in order, each exactly once. */
  readonly rows: readonly string[];
  /** Stamp `completedAt`; a paused turn is not complete. */
  readonly completes: boolean;
  readonly disposition: TerminalDisposition;
}

const RETURN: TerminalDisposition = { kind: "return" };

/** The fixed strings of the table, in one place. Every one is pinned by a golden or a hermetic assertion. */
export const TERMINAL_COPY = {
  pause: {
    row: "Execution paused by user. Use resume to continue.",
    throwMessage: "Activity paused by orchestrator",
    throwMessageAfterError: "Activity paused by orchestrator (error during pause)",
  },
  workerShutdown: {
    error: "Execution interrupted: runner worker was shut down. Retry or resume.",
    row: "Execution interrupted: the runner worker was shut down while the agent was still running. You can retry or resume.",
    throwMessage: "Activity cancelled (worker shutdown, not user pause)",
  },
  infrastructureCancel: {
    error: "Execution interrupted: agent was unresponsive (heartbeat timeout). Retry or resume.",
    row: "Execution interrupted: the agent was unresponsive for too long. You can retry or resume.",
    throwMessage: "Activity cancelled (heartbeat timeout, not user pause)",
    throwMessageAfterError: "Activity cancelled (infrastructure, not user pause)",
  },
  platformStop: {
    row: "Execution stopped by the platform.",
  },
  rejectedByUser: {
    error: "Execution rejected by user",
    row: "Execution was rejected by the user during tool approval.",
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
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: formatStallFailure(error),
    rows: [
      `Execution failed: the agent made no progress for too long and was stopped (${error.message}). You can retry or resume.`,
    ],
    completes: true,
    disposition: RETURN,
  };
}

/**
 * The cost cap stopped the turn. TERMINATED, not FAILED: the platform
 * deliberately stopped the run, work is checkpointed, and the conversation
 * continues on the next message (the recursion-limit precedent in
 * `execute-deep-agent/streaming-terminal.ts`). RETURN: a retry would burn
 * the same budget again.
 */
export function costCapArm(maxCostUsd: number, estimatedCostUsd: number): TerminalArm {
  return {
    phase: ExecutionPhase.EXECUTION_TERMINATED,
    error: formatCostLimitError(maxCostUsd, estimatedCostUsd),
    rows: [COST_LIMIT_USER_COPY],
    completes: true,
    disposition: RETURN,
  };
}

/** The runner is draining. Not a user pause: FAILED with the shutdown copy, thrown as cancelled. */
export function workerShutdownArm(): TerminalArm {
  return {
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: TERMINAL_COPY.workerShutdown.error,
    rows: [TERMINAL_COPY.workerShutdown.row],
    completes: true,
    disposition: { kind: "throw", message: TERMINAL_COPY.workerShutdown.throwMessage },
  };
}

/** The orchestrator paused the execution. Not an error, not complete; thrown as cancelled. */
export function pauseArm(): TerminalArm {
  return {
    phase: ExecutionPhase.EXECUTION_PAUSED,
    rows: [TERMINAL_COPY.pause.row],
    completes: false,
    disposition: { kind: "throw", message: TERMINAL_COPY.pause.throwMessage },
  };
}

/** Temporal cancelled for its own reason (a heartbeat timeout). FAILED with the unresponsive copy, thrown as cancelled. */
export function infrastructureCancelArm(): TerminalArm {
  return {
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: TERMINAL_COPY.infrastructureCancel.error,
    rows: [TERMINAL_COPY.infrastructureCancel.row],
    completes: true,
    disposition: { kind: "throw", message: TERMINAL_COPY.infrastructureCancel.throwMessage },
  };
}

/** The control plane answered STOP. A clean COMPLETED early exit. */
export function platformStopArm(): TerminalArm {
  return {
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    rows: [TERMINAL_COPY.platformStop.row],
    completes: true,
    disposition: RETURN,
  };
}

/** Another turn held the primary tree past the lock timeout. RETURN: a retry would queue behind the same holder. */
export function workspaceLockTimeoutArm(error: WorkspaceLockTimeoutError): TerminalArm {
  return {
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: error.message,
    rows: [`Execution failed: ${error.message}`],
    completes: true,
    disposition: RETURN,
  };
}

/** An adjudicated irreversible action (shell / MCP) was REJECTed. */
export function rejectedByUserArm(): TerminalArm {
  return {
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: TERMINAL_COPY.rejectedByUser.error,
    rows: [TERMINAL_COPY.rejectedByUser.row],
    completes: true,
    disposition: RETURN,
  };
}

/**
 * A pure file-review resume: the agent already finished its turn during
 * capture, so keeping or discarding a change never re-prompts it
 * (Cursor-like); the reconcile is the whole act and the execution is
 * complete. A failed reconcile (what-you-approve-is-what-applies could not
 * be honored) tells the human; a discard tells the human which files were
 * reverted — the agent's native context still believes those edits stuck,
 * and any edit it makes from that belief is re-surfaced next turn (the
 * structural safety net; design-decisions/capture-reject-next-turn-resync-not-built.md).
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
  return { phase: ExecutionPhase.EXECUTION_COMPLETED, rows, completes: true, disposition: RETURN };
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
  return { phase: ExecutionPhase.EXECUTION_FAILED, error: message, rows, completes: true, disposition: RETURN };
}

/**
 * An error the runtime caught itself, outside any adapter (a resolution
 * phase, the epilogue): the boilerplate row and the described error as the
 * details, with `status.error` carrying the `Execution failed:` prefix the
 * orchestrator's generic arm always wrote (`describeExecutionError` supplies
 * the two parts). The one arm whose `error` and details row differ, kept as
 * it was because the resolution-error golden pins both.
 */
export function unexpectedErrorArm(errorType: string, errorMessage: string): TerminalArm {
  const described = `[${errorType}] ${errorMessage}`;
  return {
    phase: ExecutionPhase.EXECUTION_FAILED,
    error: `Execution failed: ${described}`,
    rows: [TERMINAL_COPY.internalFailure.row, `Error details: ${described}`],
    completes: true,
    disposition: RETURN,
  };
}

// ── Applying an arm ─────────────────────────────────────────────────────────

/**
 * Append system rows, each with its own timestamp, in order. Module-private
 * on purpose: rows reach a status only through `applyTerminalArm`, so no
 * caller can append an arm's copy a second time (the shape of stigmer#1054).
 */
function appendSystemRows(status: AgentExecutionStatus, rows: readonly string[]): void {
  for (const content of rows) {
    status.messages.push(create(AgentMessageSchema, { type: MessageType.MESSAGE_SYSTEM, content, timestamp: utcTimestamp() }));
  }
}

/** Write an arm onto the status: phase, error, completion stamp, rows. The caller persists and disposes. */
export function applyTerminalArm(status: AgentExecutionStatus, arm: TerminalArm): void {
  status.phase = arm.phase;
  if (arm.error !== undefined) status.error = arm.error;
  if (arm.completes) status.completedAt = utcTimestamp();
  appendSystemRows(status, arm.rows);
}
