"use client";

import { useState } from "react";
import { cn } from "@stigmer/theme";

/**
 * Recognizes a recoverable *interruption* (worker reaped / heartbeat timeout /
 * stall) as opposed to a genuine application failure. The runner stamps these
 * with a stable signature ("[StallTimeoutError]", "Execution interrupted",
 * "Retry or resume."), and the workflow auto-resumes them while recovery cycles
 * remain; by the time one reaches the UI as terminal it is resumable from the
 * session's persisted harness_state_id rather than a dead end.
 */
function isInterruptedError(error: string): boolean {
  return /\[StallTimeoutError\]|execution interrupted|retry or resume/i.test(error);
}

/** Props for {@link ExecutionErrorNotice} and its MessageThread slot. */
export interface ExecutionErrorNoticeProps {
  /** The server-reported failure reason (`AgentExecutionStatus.error`), raw. */
  readonly error: string;
  /**
   * The originating user message, resent verbatim on retry. Absent when the
   * failed execution has no resendable prompt — the retry affordance is
   * hidden in that case.
   */
  readonly retryMessage?: string;
  /**
   * Resends {@link retryMessage}; the server continues from the session's
   * persisted harness_state_id. Retry renders only when both this handler
   * and {@link retryMessage} are present.
   */
  readonly onRetry?: (message: string) => void;
}

/**
 * Renders the server-reported failure reason (`AgentExecutionStatus.error`)
 * for an execution that died — typically before producing any messages. The
 * reason can be a long Temporal error, so it is clamped by default with a
 * Show more / Show less toggle.
 *
 * A genuine failure renders as a destructive alert with a Retry. A *recoverable
 * interruption* renders as a neutral notice with a Resume — both resend the
 * originating message, which the server continues from the session's persisted
 * harness_state_id (the same data path; the framing differs so an interruption
 * never looks like a dead-end crash).
 *
 * Slot-overridable via `MessageThreadSlots.ExecutionErrorNotice`. An override
 * receives the raw reason and the retry wiring and owns its own presentation —
 * including whether to reproduce the interruption-vs-failure framing, which is
 * an internal heuristic of this built-in, not part of the slot contract.
 */
export function ExecutionErrorNotice({
  error,
  retryMessage,
  onRetry,
}: ExecutionErrorNoticeProps) {
  const [expanded, setExpanded] = useState(false);
  const canRetry = !!onRetry && !!retryMessage;
  const interrupted = isInterruptedError(error);

  return (
    <div
      role={interrupted ? "status" : "alert"}
      className={cn(
        "stg:mx-4 stg:flex stg:flex-col stg:gap-1.5 stg:rounded-md stg:px-3 stg:py-2",
        interrupted ? "stg:bg-muted" : "stg:bg-destructive-subtle",
      )}
    >
      <p
        className={cn(
          "stg:text-xs stg:whitespace-pre-wrap stg:break-words",
          interrupted ? "stg:text-foreground" : "stg:text-destructive",
          !expanded && "stg:line-clamp-3",
        )}
      >
        {error}
      </p>
      <div className="stg:flex stg:items-center stg:gap-3 stg:text-xs">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="stg:font-medium stg:text-muted-foreground stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
        {canRetry && (
          <button
            type="button"
            onClick={() => onRetry!(retryMessage!)}
            className="stg:font-medium stg:text-foreground stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            {interrupted ? "Resume" : "Retry"}
          </button>
        )}
      </div>
    </div>
  );
}
