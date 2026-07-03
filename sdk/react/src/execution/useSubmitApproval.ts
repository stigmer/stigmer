"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useKeyedSubmission } from "../internal/useKeyedSubmission.js";

/** Return value of {@link useSubmitApproval}. */
export interface UseSubmitApprovalReturn {
  /**
   * Submit an approval decision for a specific tool call within an
   * execution. Resolves when the backend accepts the decision; the
   * execution stream will deliver the updated state.
   */
  readonly submitApproval: (
    executionId: string,
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  /**
   * Set of tool call IDs currently being submitted. Enables per-button
   * loading state in batch approval scenarios where the user may
   * approve one tool while another decision is still in flight.
   */
  readonly submittingToolCallIds: ReadonlySet<string>;
  /**
   * Per-tool-call failures, keyed by `toolCallId` exactly like
   * {@link submittingToolCallIds}. This is the per-target parallel of the
   * in-flight Set: a thread can hold many simultaneous gates (one per inline
   * tool row, plus the bottom backstop), so a failure must be attributable to
   * the *one* gate that failed — a single scalar cannot say which. {@link
   * ApprovalCard} / {@link ApprovalCardBody} consume this (threaded via
   * {@link ApprovalContext}) to render the error in-card, beside the failed gate.
   */
  readonly errorsByToolCallId: ReadonlyMap<string, Error>;
  /**
   * Error from the last failed approval submission, or `null` when healthy — a
   * convenience mirror of {@link errorsByToolCallId} for a headless consumer
   * that wants a single error value (e.g. a banner, or the `ink` surface). The
   * map is authoritative for per-gate surfacing.
   */
  readonly error: Error | null;
  /** Reset every approval error (both {@link errorsByToolCallId} and {@link error}). */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `agentExecution.submitApproval()` with
 * per-tool-call loading state and error management.
 *
 * Tracks submitting state per tool call ID (not a single boolean)
 * because batch approvals allow concurrent decisions on different
 * tool calls within the same execution.
 *
 * Platform builders who need full control over the approval UI use
 * this hook directly. Those who prefer drop-in components use
 * {@link ApprovalCard} which accepts the callback shape produced
 * by this hook.
 *
 * @example
 * ```tsx
 * const { submitApproval, submittingToolCallIds, error } = useSubmitApproval();
 *
 * await submitApproval(executionId, toolCallId, ApprovalAction.APPROVAL_ACTION_APPROVE);
 * ```
 */
export function useSubmitApproval(): UseSubmitApprovalReturn {
  const stigmer = useStigmer();
  // Per-gate in-flight + error state, keyed by tool-call id, lives in the
  // shared keyed-submission primitive. The scalar `error` below is a thin
  // mirror kept in lockstep for headless / ink consumers.
  const keyed = useKeyedSubmission<void>();
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => {
    keyed.clearErrors();
    setError(null);
  }, [keyed.clearErrors]);

  const submitApproval = useCallback(
    async (
      executionId: string,
      toolCallId: string,
      action: ApprovalAction,
      comment?: string,
    ): Promise<void> => {
      // Clear the scalar mirror at submit-start; `keyed.run` clears this gate's
      // keyed entry, so the map and `error` are updated together and never drift.
      setError(null);
      try {
        await keyed.run(toolCallId, async () => {
          await stigmer.agentExecution.submitApproval(
            create(SubmitApprovalInputSchema, {
              agentExecutionId: executionId,
              toolCallId,
              action,
              comment: comment ?? "",
            }),
          );
        });
      } catch (err) {
        setError(toError(err));
        throw err;
      }
    },
    [stigmer, keyed.run],
  );

  return useMemo(
    () => ({
      submitApproval,
      submittingToolCallIds: keyed.submittingKeys,
      errorsByToolCallId: keyed.errorsByKey,
      error,
      clearError,
    }),
    [submitApproval, keyed.submittingKeys, keyed.errorsByKey, error, clearError],
  );
}
