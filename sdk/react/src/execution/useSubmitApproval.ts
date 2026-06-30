"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** A stable empty map so an error-free hook keeps a constant `errorsByToolCallId` ref. */
const NO_ERRORS: ReadonlyMap<string, Error> = new Map();

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
  const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [errorsByToolCallId, setErrorsByToolCallId] =
    useState<ReadonlyMap<string, Error>>(NO_ERRORS);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => {
    setErrorsByToolCallId(NO_ERRORS);
    setError(null);
  }, []);

  const submitApproval = useCallback(
    async (
      executionId: string,
      toolCallId: string,
      action: ApprovalAction,
      comment?: string,
    ): Promise<void> => {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.add(toolCallId);
        return next;
      });
      // Clear this gate's prior failure (and the scalar mirror) so a retry
      // starts clean — the map and `error` are updated together, never drift.
      setErrorsByToolCallId((prev) => {
        if (!prev.has(toolCallId)) return prev;
        const next = new Map(prev);
        next.delete(toolCallId);
        return next;
      });
      setError(null);

      try {
        const input = create(SubmitApprovalInputSchema, {
          agentExecutionId: executionId,
          toolCallId,
          action,
          comment: comment ?? "",
        });
        await stigmer.agentExecution.submitApproval(input);
      } catch (err) {
        const e = toError(err);
        setErrorsByToolCallId((prev) => new Map(prev).set(toolCallId, e));
        setError(e);
        throw err;
      } finally {
        setSubmittingIds((prev) => {
          const next = new Set(prev);
          next.delete(toolCallId);
          return next;
        });
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({
      submitApproval,
      submittingToolCallIds: submittingIds,
      errorsByToolCallId,
      error,
      clearError,
    }),
    [submitApproval, submittingIds, errorsByToolCallId, error, clearError],
  );
}
