"use client";

import { useCallback, useRef, useState } from "react";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  CancelWorkflowExecutionInputSchema,
  TerminateWorkflowExecutionInputSchema,
  PauseWorkflowExecutionInputSchema,
  ResumeWorkflowExecutionInputSchema,
  RecoverWorkflowExecutionInputSchema,
  SubmitWorkflowApprovalInputSchema,
  SubmitWorkflowTaskApprovalInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Options for {@link useWorkflowExecutionActions}. */
export interface UseWorkflowExecutionActionsOptions {
  /**
   * Called after any lifecycle action (cancel, terminate, pause, resume,
   * recover) succeeds. Receives the updated execution returned by the
   * server. Useful for triggering a refetch of execution data so the UI
   * reflects the new phase.
   *
   * Not called for approval submissions — those are background operations
   * whose effects arrive via the event stream.
   */
  readonly onSuccess?: (execution: WorkflowExecution) => void;
}

/** Return value of {@link useWorkflowExecutionActions}. */
export interface UseWorkflowExecutionActionsReturn {
  /** Cancel a running execution gracefully. */
  readonly cancel: (reason?: string) => Promise<WorkflowExecution | null>;
  /** Terminate a running execution immediately. */
  readonly terminate: (reason?: string) => Promise<WorkflowExecution | null>;
  /** Pause a running execution. */
  readonly pause: (reason?: string) => Promise<WorkflowExecution | null>;
  /** Resume a paused execution. */
  readonly resume: () => Promise<WorkflowExecution | null>;
  /** Recover a failed execution from its last checkpoint. */
  readonly recover: (reason?: string) => Promise<WorkflowExecution | null>;
  /** Submit an approval decision for a child agent's tool execution. */
  readonly submitApproval: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<WorkflowExecution | null>;
  /**
   * Submit a reviewer's decision for a workflow-level human_input task.
   *
   * Unlike `submitApproval` (which forwards agent tool approvals),
   * this sends a Temporal signal to the workflow runner's human_input
   * orchestrator, unblocking the task with the selected outcome.
   */
  readonly submitTaskApproval: (
    taskName: string,
    outcome: string,
    formData?: Record<string, unknown>,
    comment?: string,
  ) => Promise<WorkflowExecution | null>;
  /** `true` while any action is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed action, or `null`. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that encapsulates workflow execution lifecycle actions.
 *
 * Each action calls the corresponding RPC and returns the updated
 * execution, or `null` on failure (with `error` populated).
 *
 * Pass `null` for `executionId` to disable all actions (they become
 * no-ops that return `null`).
 *
 * @example
 * ```tsx
 * const actions = useWorkflowExecutionActions(executionId, {
 *   onSuccess: () => refetchExecution(),
 * });
 *
 * <button onClick={() => actions.cancel("No longer needed")} disabled={actions.isSubmitting}>
 *   Cancel
 * </button>
 * ```
 */
export function useWorkflowExecutionActions(
  executionId: string | null,
  options?: UseWorkflowExecutionActionsOptions,
): UseWorkflowExecutionActionsReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const executionIdRef = useRef(executionId);
  executionIdRef.current = executionId;
  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;
  const onSuccessRef = useRef(options?.onSuccess);
  onSuccessRef.current = options?.onSuccess;

  const clearError = useCallback(() => setError(null), []);

  const wrap = useCallback(
    async (
      fn: () => Promise<WorkflowExecution>,
      fireOnSuccess = true,
    ): Promise<WorkflowExecution | null> => {
      if (!executionIdRef.current) return null;
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await fn();
        if (fireOnSuccess) onSuccessRef.current?.(result);
        return result;
      } catch (err) {
        setError(toError(err));
        return null;
      } finally {
        setIsSubmitting(false);
      }
    },
    [],
  );

  const cancel = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.workflowExecution.cancel(
          create(CancelWorkflowExecutionInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const terminate = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.workflowExecution.terminate(
          create(TerminateWorkflowExecutionInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const pause = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.workflowExecution.pause(
          create(PauseWorkflowExecutionInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const resume = useCallback(
    () =>
      wrap(() =>
        stigmerRef.current.workflowExecution.resume(
          create(ResumeWorkflowExecutionInputSchema, {
            id: executionIdRef.current!,
          }),
        ),
      ),
    [wrap],
  );

  const recover = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.workflowExecution.recover(
          create(RecoverWorkflowExecutionInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const submitApproval = useCallback(
    (toolCallId: string, action: ApprovalAction, comment?: string) =>
      wrap(
        () =>
          stigmerRef.current.workflowExecution.submitApproval(
            create(SubmitWorkflowApprovalInputSchema, {
              executionId: executionIdRef.current!,
              toolCallId,
              action,
              comment: comment ?? "",
            }),
          ),
        false,
      ),
    [wrap],
  );

  const submitTaskApproval = useCallback(
    (taskName: string, outcome: string, formData?: Record<string, unknown>, comment?: string) =>
      wrap(
        () =>
          stigmerRef.current.workflowExecution.submitWorkflowTaskApproval(
            create(SubmitWorkflowTaskApprovalInputSchema, {
              executionId: executionIdRef.current!,
              taskName,
              outcome,
              formData: formData as JsonObject | undefined,
              reviewer: "",
              comment: comment ?? "",
            }),
          ),
        false,
      ),
    [wrap],
  );

  return {
    cancel,
    terminate,
    pause,
    resume,
    recover,
    submitApproval,
    submitTaskApproval,
    isSubmitting,
    error,
    clearError,
  };
}
