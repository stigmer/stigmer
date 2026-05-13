"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Field-level validation errors keyed by field name. */
export type RunWorkflowFieldErrors = Record<string, string>;

/** Options for {@link useRunWorkflowFlow}. */
export interface UseRunWorkflowFlowOptions {
  /** Organization slug that owns the workflow. */
  readonly org: string;
  /** Workflow resource (must include metadata and spec). */
  readonly workflow: Workflow;
  /** Available workflow instances (for instance selector). */
  readonly instances: readonly WorkflowInstance[];
  /**
   * Called after the execution is created successfully.
   * Receives the execution ID for navigation.
   */
  readonly onSuccess: (executionId: string) => void;
  /**
   * Called when submission fails. Receives a human-readable message.
   * Errors are also available via {@link UseRunWorkflowFlowReturn.error}.
   */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useRunWorkflowFlow}. */
export interface UseRunWorkflowFlowReturn {
  /** Current trigger message value. */
  readonly triggerMessage: string;
  /** Update the trigger message. */
  readonly setTriggerMessage: (value: string) => void;

  /** Current runtime environment variable overrides (keyed by var name). */
  readonly runtimeEnv: Record<string, string>;
  /** Update a single env var value. */
  readonly setEnvVar: (key: string, value: string) => void;

  /** Selected instance ID, or `null` for server-resolved default. */
  readonly selectedInstanceId: string | null;
  /** Update the selected instance. */
  readonly setSelectedInstanceId: (id: string | null) => void;

  /** Declared environment variables from the workflow spec. */
  readonly envDeclarations: Record<string, EnvVarDeclaration>;

  /** Field-level validation errors (empty when valid). */
  readonly fieldErrors: RunWorkflowFieldErrors;

  /** `true` while the create execution RPC is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed submission, or `null`. */
  readonly error: string | null;

  /** Validate form fields. Returns `true` if valid. */
  readonly validate: () => boolean;
  /** Validate, then create the workflow execution. */
  readonly submit: () => Promise<void>;
  /** Reset all form state to initial values. */
  readonly reset: () => void;
}

/**
 * Behavior hook that orchestrates the "run a workflow" flow.
 *
 * Manages form state (trigger message, runtime env overrides, instance
 * selection), validates required fields, and calls
 * `WorkflowExecutionClient.create()` on submission. On success, the
 * consumer-provided `onSuccess` callback receives the execution ID for
 * navigation or further action.
 *
 * This hook is framework-agnostic — it works identically in Next.js,
 * Vite, Tauri, or any React environment. Navigation and toast feedback
 * are the consumer's responsibility.
 *
 * @example
 * ```tsx
 * const flow = useRunWorkflowFlow({
 *   org: "acme",
 *   workflow,
 *   instances,
 *   onSuccess: (id) => router.push(`/workflows/executions/${id}`),
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <input value={flow.triggerMessage} onChange={e => flow.setTriggerMessage(e.target.value)} />
 * <button onClick={flow.submit} disabled={flow.isSubmitting}>Run</button>
 * ```
 */
export function useRunWorkflowFlow(
  options: UseRunWorkflowFlowOptions,
): UseRunWorkflowFlowReturn {
  const { org, workflow, instances, onSuccess, onError } = options;
  const stigmer = useStigmer();

  const [triggerMessage, setTriggerMessage] = useState("");
  const [runtimeEnv, setRuntimeEnv] = useState<Record<string, string>>({});
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<RunWorkflowFieldErrors>({});

  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const envDeclarations = useMemo<Record<string, EnvVarDeclaration>>(
    () => (workflow.spec?.env ? { ...workflow.spec.env } : {}),
    [workflow.spec?.env],
  );

  const setEnvVar = useCallback((key: string, value: string) => {
    setRuntimeEnv((prev) => ({ ...prev, [key]: value }));
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const validate = useCallback((): boolean => {
    const errors: RunWorkflowFieldErrors = {};
    for (const [key, decl] of Object.entries(envDeclarations)) {
      if (!decl.optional && !runtimeEnv[key]?.trim()) {
        errors[key] = `${key} is required`;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [envDeclarations, runtimeEnv]);

  const submit = useCallback(async () => {
    if (isSubmitting) return;
    if (!validate()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const workflowName =
        workflow.metadata?.name || workflow.metadata?.slug || "Workflow";

      const envInput: Record<string, { value: string; isSecret?: boolean }> =
        {};
      for (const [key, value] of Object.entries(runtimeEnv)) {
        if (value.trim()) {
          const isSecret = envDeclarations[key]?.isSecret ?? false;
          envInput[key] = { value, isSecret };
        }
      }

      const execution: WorkflowExecution =
        await stigmerRef.current.workflowExecution.create({
          name: `${workflowName} execution`,
          org,
          workflowId: selectedInstanceId
            ? undefined
            : workflow.metadata?.id,
          workflowInstanceId: selectedInstanceId ?? undefined,
          triggerMessage: triggerMessage || undefined,
          triggerMetadata: {
            source: "ui",
            timestamp: new Date().toISOString(),
          },
          runtimeEnv:
            Object.keys(envInput).length > 0 ? envInput : undefined,
        });

      const executionId = execution.metadata?.id;
      if (!executionId) {
        throw new Error(
          "Execution was created but no ID was returned. Please check the executions list.",
        );
      }

      onSuccessRef.current(executionId);
    } catch (err) {
      const message = getUserMessage(
        err,
        "Failed to start workflow execution",
      );
      setError(message);
      onErrorRef.current?.(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [
    isSubmitting,
    validate,
    workflow.metadata,
    org,
    selectedInstanceId,
    triggerMessage,
    runtimeEnv,
    envDeclarations,
  ]);

  const reset = useCallback(() => {
    setTriggerMessage("");
    setRuntimeEnv({});
    setSelectedInstanceId(null);
    setError(null);
    setFieldErrors({});
  }, []);

  return {
    triggerMessage,
    setTriggerMessage,
    runtimeEnv,
    setEnvVar,
    selectedInstanceId,
    setSelectedInstanceId,
    envDeclarations,
    fieldErrors,
    isSubmitting,
    error,
    validate,
    submit,
    reset,
  };
}
