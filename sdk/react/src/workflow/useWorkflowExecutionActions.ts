"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import type { ApprovalAction, FileDecisionAction } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { FileDecisionScope } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import { create, type JsonObject } from "@bufbuild/protobuf";
import {
  CancelWorkflowRunInputSchema,
  TerminateWorkflowRunInputSchema,
  PauseWorkflowRunInputSchema,
  ResumeWorkflowRunInputSchema,
  RecoverWorkflowRunInputSchema,
  SubmitWorkflowApprovalInputSchema,
  SubmitWorkflowTaskApprovalInputSchema,
  SubmitWorkflowFileDecisionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { useKeyedSubmission } from "../internal/useKeyedSubmission.js";
import { fileDecisionKey, type FileDecisionOptions } from "../execution/useFileReview.js";

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
  readonly onSuccess?: (execution: WorkflowRun) => void;
}

/** Return value of {@link useWorkflowExecutionActions}. */
export interface UseWorkflowExecutionActionsReturn {
  /** Cancel a running execution gracefully. */
  readonly cancel: (reason?: string) => Promise<WorkflowRun | null>;
  /** Terminate a running execution immediately. */
  readonly terminate: (reason?: string) => Promise<WorkflowRun | null>;
  /** Pause a running execution. */
  readonly pause: (reason?: string) => Promise<WorkflowRun | null>;
  /** Resume a paused execution. */
  readonly resume: () => Promise<WorkflowRun | null>;
  /**
   * Recover a failed execution with task-level resume.
   *
   * Terminates stale workflows, re-resolves environment variables (picks up
   * any config fixes), and starts a fresh run in recovery mode. Completed
   * tasks are skipped — their outputs are restored from the event log —
   * and execution resumes from the first incomplete or failed task.
   *
   * @param reason - Optional audit trail message explaining why recovery
   *   was triggered (e.g., "Rotated API key").
   */
  readonly recover: (reason?: string) => Promise<WorkflowRun | null>;
  /** Submit an approval decision for a child agent's tool execution. */
  readonly submitApproval: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => Promise<WorkflowRun | null>;
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
  ) => Promise<WorkflowRun | null>;
  /**
   * Submit a keep/discard decision for a child agent's file review, surfaced on
   * this workflow via `status.pending_file_reviews`. The file-review sibling of
   * {@link submitApproval}: the server forwards it to the child's
   * `AgentExecution.submitFileDecision`.
   *
   * `childAgentExecutionId` comes from the surfaced
   * `WorkflowPendingFileReview` reference. `options` carries the same
   * per-decision detail as {@link FileReviewCard}'s `onSubmit` (scope,
   * `fileChangeId`, `expectedDigest`, `reason`, `acknowledgeUnreviewable`).
   */
  readonly submitFileDecision: (
    childAgentExecutionId: string,
    changeSetId: string,
    action: FileDecisionAction,
    options?: FileDecisionOptions,
  ) => Promise<WorkflowRun | null>;
  /**
   * `true` while a **lifecycle** action (cancel/terminate/pause/resume/recover)
   * is in flight. Approvals are excluded — they are per-gate, so read their
   * in-flight state from {@link approvalSubmittingToolCallIds} /
   * {@link taskApprovalSubmittingTaskNames} instead.
   */
  readonly isSubmitting: boolean;
  /**
   * Error from the last failed **lifecycle** action, or `null`. Approval
   * failures are per-gate and live in {@link approvalErrorsByToolCallId} /
   * {@link taskApprovalErrorsByTaskName} so each surfaces beside the gate that
   * failed — never in this shared scalar (which backs the header banner).
   */
  readonly error: Error | null;
  /** Reset the lifecycle {@link error} to `null`. */
  readonly clearError: () => void;
  /**
   * Tool-call ids whose agent-tool approval is currently being submitted, keyed
   * exactly like {@link approvalErrorsByToolCallId}. A workflow can hold many
   * concurrent gates, so deciding one must not spin or disable the others.
   */
  readonly approvalSubmittingToolCallIds: ReadonlySet<string>;
  /**
   * Per-gate agent-tool approval failures, keyed by `toolCallId`. Consumed by
   * `WorkflowApprovalList` (via the shared `ApprovalCard`) to surface the
   * failure in-card, beside the gate that failed. Cleared for a gate when it
   * is retried.
   */
  readonly approvalErrorsByToolCallId: ReadonlyMap<string, Error>;
  /**
   * Task names whose human_input task approval is currently being submitted,
   * keyed exactly like {@link taskApprovalErrorsByTaskName}.
   */
  readonly taskApprovalSubmittingTaskNames: ReadonlySet<string>;
  /**
   * Per-gate human_input task approval failures, keyed by `taskName`. Consumed
   * by `WorkflowTaskApprovalCard` to surface the failure in-card, beside
   * the gate that failed. Cleared for a gate when it is retried.
   */
  readonly taskApprovalErrorsByTaskName: ReadonlyMap<string, Error>;
  /**
   * Decision keys currently being submitted for file reviews, keyed exactly like
   * {@link FileReviewCard}'s `submittingDecisionKeys` (via {@link fileDecisionKey}
   * — the change set id for a whole-set decision, `changeSetId:fileChangeId` for a
   * per-file one). Pass straight through to each surfaced card.
   */
  readonly fileDecisionSubmittingKeys: ReadonlySet<string>;
  /**
   * Per-decision file-review failures, keyed like {@link fileDecisionSubmittingKeys}.
   * Pass straight through to {@link FileReviewCard}'s `decisionErrors`.
   */
  readonly fileDecisionErrorsByKey: ReadonlyMap<string, Error>;
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

  // Approvals are per-gate (a workflow can hold many at once), so each kind gets
  // its own keyed in-flight + error state — keyed by tool-call id for agent-tool
  // approvals and by task name for human_input task approvals. The lifecycle
  // actions below stay on the shared scalar (they are header singletons).
  const approvals = useKeyedSubmission<WorkflowRun>();
  const taskApprovals = useKeyedSubmission<WorkflowRun>();
  const fileDecisions = useKeyedSubmission<WorkflowRun>();

  const executionIdRef = useRef(executionId);
  executionIdRef.current = executionId;
  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;
  const onSuccessRef = useRef(options?.onSuccess);
  onSuccessRef.current = options?.onSuccess;

  const clearError = useCallback(() => setError(null), []);

  const wrap = useCallback(
    async (
      fn: () => Promise<WorkflowRun>,
      fireOnSuccess = true,
    ): Promise<WorkflowRun | null> => {
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
        stigmerRef.current.workflowRun.cancel(
          create(CancelWorkflowRunInputSchema, {
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
        stigmerRef.current.workflowRun.terminate(
          create(TerminateWorkflowRunInputSchema, {
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
        stigmerRef.current.workflowRun.pause(
          create(PauseWorkflowRunInputSchema, {
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
        stigmerRef.current.workflowRun.resume(
          create(ResumeWorkflowRunInputSchema, {
            id: executionIdRef.current!,
          }),
        ),
      ),
    [wrap],
  );

  const recover = useCallback(
    (reason?: string) =>
      wrap(() =>
        stigmerRef.current.workflowRun.recover(
          create(RecoverWorkflowRunInputSchema, {
            id: executionIdRef.current!,
            reason: reason ?? "",
          }),
        ),
      ),
    [wrap],
  );

  // Approvals do NOT go through `wrap`: their in-flight + error state is keyed
  // (per gate), and the keyed primitive re-throws after recording, so we swallow
  // to `null` here to keep the `WorkflowExecution | null` contract. They never
  // fire `onSuccess` — their effects arrive via the event stream.
  const submitApproval = useCallback(
    (toolCallId: string, action: ApprovalAction, comment?: string) => {
      if (!executionIdRef.current) return Promise.resolve(null);
      return approvals
        .run(toolCallId, () =>
          stigmerRef.current.workflowRun.submitApproval(
            create(SubmitWorkflowApprovalInputSchema, {
              runId: executionIdRef.current!,
              toolCallId,
              action,
              comment: comment ?? "",
            }),
          ),
        )
        .catch(() => null);
    },
    [approvals.run],
  );

  const submitTaskApproval = useCallback(
    (taskName: string, outcome: string, formData?: Record<string, unknown>, comment?: string) => {
      if (!executionIdRef.current) return Promise.resolve(null);
      return taskApprovals
        .run(taskName, () =>
          stigmerRef.current.workflowRun.submitWorkflowTaskApproval(
            create(SubmitWorkflowTaskApprovalInputSchema, {
              runId: executionIdRef.current!,
              taskName,
              outcome,
              formData: formData as JsonObject | undefined,
              reviewer: "",
              comment: comment ?? "",
            }),
          ),
        )
        .catch(() => null);
    },
    [taskApprovals.run],
  );

  // File decisions are per-target (a workflow can surface many change sets across
  // parallel children), so they use the keyed primitive keyed exactly like
  // FileReviewCard expects (fileDecisionKey). Never fires onSuccess — the effect
  // arrives via the execution stream.
  const submitFileDecision = useCallback(
    (
      childAgentExecutionId: string,
      changeSetId: string,
      action: FileDecisionAction,
      options?: FileDecisionOptions,
    ) => {
      if (!executionIdRef.current) return Promise.resolve(null);
      const fileChangeId = options?.fileChangeId ?? "";
      const scope =
        options?.scope ??
        (fileChangeId ? FileDecisionScope.FILE : FileDecisionScope.CHANGE_SET);
      const key = fileDecisionKey(changeSetId, fileChangeId || undefined);
      return fileDecisions
        .run(key, () =>
          stigmerRef.current.workflowRun.submitFileDecision(
            create(SubmitWorkflowFileDecisionInputSchema, {
              runId: executionIdRef.current!,
              childAgentRunId: childAgentExecutionId,
              changeSetId,
              scope,
              fileChangeId,
              action,
              expectedDigest: options?.expectedDigest ?? "",
              reason: options?.reason ?? "",
              acknowledgeUnreviewable: options?.acknowledgeUnreviewable ?? false,
            }),
          ),
        )
        .catch(() => null);
    },
    [fileDecisions.run],
  );

  return useMemo(
    () => ({
      cancel,
      terminate,
      pause,
      resume,
      recover,
      submitApproval,
      submitTaskApproval,
      submitFileDecision,
      isSubmitting,
      error,
      clearError,
      approvalSubmittingToolCallIds: approvals.submittingKeys,
      approvalErrorsByToolCallId: approvals.errorsByKey,
      taskApprovalSubmittingTaskNames: taskApprovals.submittingKeys,
      taskApprovalErrorsByTaskName: taskApprovals.errorsByKey,
      fileDecisionSubmittingKeys: fileDecisions.submittingKeys,
      fileDecisionErrorsByKey: fileDecisions.errorsByKey,
    }),
    [
      cancel,
      terminate,
      pause,
      resume,
      recover,
      submitApproval,
      submitTaskApproval,
      submitFileDecision,
      isSubmitting,
      error,
      clearError,
      approvals.submittingKeys,
      approvals.errorsByKey,
      taskApprovals.submittingKeys,
      taskApprovals.errorsByKey,
      fileDecisions.submittingKeys,
      fileDecisions.errorsByKey,
    ],
  );
}
