"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

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
  /** Error from the last failed approval submission, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
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
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

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
        setError(toError(err));
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

  return { submitApproval, submittingToolCallIds: submittingIds, error, clearError };
}
