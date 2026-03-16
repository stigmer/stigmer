"use client";

import { useCallback, useState } from "react";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import { SubmitApprovalInputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { useStigmer } from "../../hooks";

export interface UseApprovalOptions {
  executionId: string;
}

export interface UseApprovalReturn {
  submit: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
  clearError: () => void;
}

export function useApproval(options: UseApprovalOptions): UseApprovalReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (toolCallId: string, action: ApprovalAction, comment?: string) => {
      setIsSubmitting(true);
      setError(null);
      try {
        await stigmer.agentExecution.submitApproval(
          create(SubmitApprovalInputSchema, {
            agentExecutionId: options.executionId,
            toolCallId,
            action,
            comment: comment ?? "",
          }),
        );
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to submit approval";
        setError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer, options.executionId],
  );

  const clearError = useCallback(() => setError(null), []);

  return { submit, isSubmitting, error, clearError };
}
