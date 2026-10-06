"use client";

/**
 * The "run a workflow" flow: form state, validation and the create call.
 *
 * A run names its workflow (`spec.workflowId`) and nothing else; there is
 * no per-run configuration object to pick. Each declared key's source is
 * read through {@link useRunEnvKeySources}, so a required key the person's
 * personal environment already holds is not demanded again, and the form
 * can say where every key will come from before the run starts. Only a
 * required key known to be missing blocks the run: one whose source is
 * still being read, or could not be read, is left to the server, which
 * fills it from the personal environment when it holds it. When the
 * workflow's runs are visible to its organization the flow says so, since
 * this run's input and output will be visible too.
 *
 * Pinned by `__tests__/useRunWorkflowFlow.test.tsx`.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowRun } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useExecutionTarget } from "../execution-target-context.js";
import { useRunnerAdapter } from "../runner-adapter.js";
import { toProtoExecutionTarget } from "../session/execution-target.js";
import { workflowUsesTriggerInput } from "./workflow-uses-trigger-input.js";
import { useRunEnvKeySources, type RunEnvKeySource } from "./useRunEnvKeySources.js";

/** Field-level validation errors keyed by field name. */
export type RunWorkflowFieldErrors = Record<string, string>;

/** Options for {@link useRunWorkflowFlow}. */
export interface UseRunWorkflowFlowOptions {
  /** Id of the organization the run is created in (a slug is also accepted). */
  readonly org: string;
  /** Workflow resource (must include metadata and spec). */
  readonly workflow: Workflow;
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

  /** Declared environment variables from the workflow spec. */
  readonly envDeclarations: Record<string, EnvVarDeclaration>;

  /**
   * Where each declared key's value will come from: typed into the form,
   * the person's personal environment, missing, or not yet known (`pending`
   * while the personal environment is read, `unknown` when that read
   * failed). A workflow of another organization than the run's never reads
   * the personal environment.
   */
  readonly envKeySources: Readonly<Record<string, RunEnvKeySource>>;

  /**
   * `true` while a declared key's source is not yet known: the personal
   * environment's key names, or the organizations that tell whether this
   * run reads them, are still being read. No key blocks the run meanwhile.
   */
  readonly isLoadingEnvKeySources: boolean;

  /**
   * `true` when every run of this workflow is visible to its organization,
   * so the run's input and output will be too. Say so before the run starts.
   */
  readonly runsVisibleToOrganization: boolean;

  /**
   * Whether the workflow references `$input` / trigger_message in its tasks.
   * When `false`, the trigger message field is irrelevant for this workflow.
   */
  readonly usesTriggerInput: boolean;

  /**
   * Whether the trigger message field should be visible in the form.
   * Defaults to `usesTriggerInput`; can be toggled by the user via
   * the escape-hatch "Add trigger input" link.
   */
  readonly showTriggerMessage: boolean;

  /** Toggle visibility of the trigger message field (escape hatch). */
  readonly setShowTriggerMessage: (show: boolean) => void;

  /** Field-level validation errors (empty when valid). */
  readonly fieldErrors: RunWorkflowFieldErrors;

  /** `true` while the create execution RPC is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed submission, or `null`. */
  readonly error: string | null;

  /**
   * Validate form fields. Returns `true` if valid. A required key fails
   * only when it is known to be missing: neither typed nor held by the
   * personal environment. A key still `pending` or `unknown` does not
   * fail, since the server fills it from the personal environment.
   */
  readonly validate: () => boolean;
  /** Validate, then create the workflow execution. */
  readonly submit: () => Promise<void>;
  /** Reset all form state to initial values. */
  readonly reset: () => void;
}

/**
 * Behavior hook that orchestrates the "run a workflow" flow.
 *
 * Manages form state (trigger message, runtime env overrides), validates
 * required fields, and calls
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
  const { org, workflow, onSuccess, onError } = options;
  const stigmer = useStigmer();
  const contextTarget = useExecutionTarget();
  const adapter = useRunnerAdapter();

  const usesTriggerInput = useMemo(
    () => workflowUsesTriggerInput(workflow),
    [workflow],
  );

  const [triggerMessage, setTriggerMessage] = useState("");
  const [runtimeEnv, setRuntimeEnv] = useState<Record<string, string>>({});
  const [showTriggerMessage, setShowTriggerMessage] = useState(usesTriggerInput);
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

  const { sources: envKeySources, isLoading: isLoadingEnvKeySources } =
    useRunEnvKeySources(workflow, org, runtimeEnv);

  const runsVisibleToOrganization =
    workflow.spec?.runVisibility ===
    WorkflowRunVisibility.organization;

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
      if (!decl.optional && envKeySources[key] === "missing") {
        errors[key] = `${key} is required`;
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [envDeclarations, envKeySources]);

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

      const execution: WorkflowRun =
        await stigmerRef.current.workflowRun.create({
          name: `${workflowName} ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
          org,
          workflowId: workflow.metadata?.id,
          triggerMessage: triggerMessage || undefined,
          triggerMetadata: {
            source: "ui",
            timestamp: new Date().toISOString(),
          },
          runtimeEnv:
            Object.keys(envInput).length > 0 ? envInput : undefined,
          executionTarget: contextTarget
            ? toProtoExecutionTarget(contextTarget)
            : undefined,
        });

      const executionId = execution.metadata?.id;
      if (!executionId) {
        throw new Error(
          "Execution was created but no ID was returned. Please check the executions list.",
        );
      }

      if (adapter && contextTarget === "local") {
        await adapter.onWorkflowExecutionCreated(executionId);
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
    triggerMessage,
    runtimeEnv,
    envDeclarations,
    adapter,
    contextTarget,
  ]);

  const reset = useCallback(() => {
    setTriggerMessage("");
    setRuntimeEnv({});
    setShowTriggerMessage(usesTriggerInput);
    setError(null);
    setFieldErrors({});
  }, [usesTriggerInput]);

  return {
    triggerMessage,
    setTriggerMessage,
    runtimeEnv,
    setEnvVar,
    envDeclarations,
    envKeySources,
    isLoadingEnvKeySources,
    runsVisibleToOrganization,
    usesTriggerInput,
    showTriggerMessage,
    setShowTriggerMessage,
    fieldErrors,
    isSubmitting,
    error,
    validate,
    submit,
    reset,
  };
}
