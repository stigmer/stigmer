"use client";

import { useCallback, useState } from "react";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useExecutionService } from "./useExecutionService";

export interface UseApprovalOptions {
  executionId: string;
}

export interface UseApprovalReturn {
  /** Submit an approval decision for a specific tool call. */
  submit: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  /** True while an approval request is in flight. */
  isSubmitting: boolean;
  /** Error message from the last failed submission. Null when healthy. */
  error: string | null;
  /** Clear the current error state. */
  clearError: () => void;
}

export function useApproval(options: UseApprovalOptions): UseApprovalReturn {
  const service = useExecutionService();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (toolCallId: string, action: ApprovalAction, comment?: string) => {
      setIsSubmitting(true);
      setError(null);
      try {
        await service.submitApproval(
          options.executionId,
          toolCallId,
          action,
          comment,
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to submit approval";
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [service, options.executionId],
  );

  const clearError = useCallback(() => setError(null), []);

  return { submit, isSubmitting, error, clearError };
}
