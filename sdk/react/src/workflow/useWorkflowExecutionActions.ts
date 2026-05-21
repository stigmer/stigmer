"use client";

import { useCallback, useRef, useState } from "react";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { create } from "@bufbuild/protobuf";
import {
  CancelWorkflowExecutionInputSchema,
  TerminateWorkflowExecutionInputSchema,
  PauseWorkflowExecutionInputSchema,
  ResumeWorkflowExecutionInputSchema,
  RecoverWorkflowExecutionInputSchema,
  SubmitWorkflowApprovalInputSchema,
  SubmitWorkflowTaskApprovalInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { Struct } from "@bufbuild/protobuf/wkt";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

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
 * const actions = useWorkflowExecutionActions(executionId);
 *
 * <button onClick={() => actions.cancel("No longer needed")} disabled={actions.isSubmitting}>
 *   Cancel
 * </button>
 * ```
 */
export function useWorkflowExecutionActions(
  executionId: string | null,
): UseWorkflowExecutionActionsReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const executionIdRef = useRef(executionId);
  executionIdRef.current = executionId;
  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;

  const wrap = useCallback(
    async (fn: () => Promise<WorkflowExecution>): Promise<WorkflowExecution | null> => {
      if (!executionIdRef.current) return null;
      setIsSubmitting(true);
      setError(null);
      try {
        const result = await fn();
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
      wrap(() =>
        stigmerRef.current.workflowExecution.submitApproval(
          create(SubmitWorkflowApprovalInputSchema, {
            executionId: executionIdRef.current!,
            toolCallId,
            action,
            comment: comment ?? "",
          }),
        ),
      ),
    [wrap],
  );

  const submitTaskApproval = useCallback(
    (taskName: string, outcome: string, formData?: Record<string, unknown>, comment?: string) =>
      wrap(() =>
        stigmerRef.current.workflowExecution.submitWorkflowTaskApproval(
          create(SubmitWorkflowTaskApprovalInputSchema, {
            executionId: executionIdRef.current!,
            taskName,
            outcome,
            formData: formData ? Struct.fromJson(formData) : undefined,
            reviewer: "",
            comment: comment ?? "",
          }),
        ),
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
  };
}
