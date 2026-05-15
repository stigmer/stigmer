"use client";

import { useCallback, useRef, useState } from "react";
import { getUserMessage, type GenerateFromPromptResult } from "@stigmer/sdk";
import { useStigmer } from "../hooks";
import { parseWorkflowYaml } from "./serialize-workflow-yaml";

/** Result from a successful workflow generation. */
export interface GenerateWorkflowResult {
  /** The generated workflow YAML. */
  readonly yaml: string;
  /** Human-readable explanation of what was generated and why. */
  readonly explanation: string;
  /** Non-fatal validation warnings (empty when clean). */
  readonly warnings: readonly string[];
  /** The LLM model that was used for generation. */
  readonly modelUsed: string;
}

/** Options for {@link useGenerateWorkflowFlow}. */
export interface UseGenerateWorkflowFlowOptions {
  /** Organization slug — used for resource context and workflow creation. */
  readonly org: string;
  /**
   * Called after the workflow is created successfully.
   * Receives the org slug and workflow slug for navigation.
   */
  readonly onSuccess: (org: string, slug: string) => void;
  /**
   * Called when generation or creation fails. Receives a human-readable message.
   * Errors are also available via {@link UseGenerateWorkflowFlowReturn.error}.
   */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useGenerateWorkflowFlow}. */
export interface UseGenerateWorkflowFlowReturn {
  /** Current prompt value. */
  readonly prompt: string;
  /** Update the prompt. */
  readonly setPrompt: (value: string) => void;

  /** Optional model override (empty = server default). */
  readonly model: string;
  /** Update the model. */
  readonly setModel: (value: string) => void;

  /** Optional task kind hints to guide generation. */
  readonly taskKindHints: string;
  /** Update the task kind hints (comma-separated string). */
  readonly setTaskKindHints: (value: string) => void;

  /** `true` while the generation RPC is in flight. */
  readonly isGenerating: boolean;
  /** `true` while the workflow is being created from generated YAML. */
  readonly isCreating: boolean;

  /** Generation result, or `null` if not yet generated. */
  readonly result: GenerateWorkflowResult | null;
  /** Error from the last failed operation, or `null`. */
  readonly error: string | null;

  /**
   * Validate the prompt and call the generation RPC.
   * On success, sets {@link result}. On failure, sets {@link error}.
   */
  readonly generate: () => Promise<void>;
  /**
   * Create a workflow from the generated YAML via `workflow.apply()`.
   * Calls `onSuccess` with the org and slug on completion.
   * Only callable when {@link result} is non-null.
   */
  readonly createWorkflow: () => Promise<void>;
  /** Reset all state to initial values (prompt, result, error). */
  readonly reset: () => void;
}

const MIN_PROMPT_LENGTH = 10;

/**
 * Behavior hook that orchestrates the "generate a workflow from prompt" flow.
 *
 * Manages two phases:
 * 1. **Generation** — user enters a prompt, hook calls
 *    `WorkflowClient.generateFromPrompt()`, returns YAML + explanation.
 * 2. **Creation** — user reviews the result, hook calls
 *    `WorkflowClient.apply()` to persist the workflow.
 *
 * This hook is framework-agnostic — it works identically in Next.js,
 * Vite, Tauri, or any React environment. Navigation and toast feedback
 * are the consumer's responsibility via `onSuccess` / `onError` callbacks.
 *
 * @example
 * ```tsx
 * const flow = useGenerateWorkflowFlow({
 *   org: "acme",
 *   onSuccess: (org, slug) => router.push(`/library/workflows/${org}/${slug}`),
 *   onError: (msg) => toast.error(msg),
 * });
 *
 * <textarea value={flow.prompt} onChange={e => flow.setPrompt(e.target.value)} />
 * <button onClick={flow.generate} disabled={flow.isGenerating}>Generate</button>
 * ```
 */
export function useGenerateWorkflowFlow(
  options: UseGenerateWorkflowFlowOptions,
): UseGenerateWorkflowFlowReturn {
  const { org, onSuccess, onError } = options;
  const stigmer = useStigmer();

  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [taskKindHints, setTaskKindHints] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [result, setResult] = useState<GenerateWorkflowResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const orgRef = useRef(org);
  orgRef.current = org;

  const generate = useCallback(async () => {
    if (isGenerating) return;

    const trimmed = prompt.trim();
    if (trimmed.length < MIN_PROMPT_LENGTH) {
      const msg = `Prompt must be at least ${MIN_PROMPT_LENGTH} characters`;
      setError(msg);
      return;
    }

    setIsGenerating(true);
    setError(null);
    setResult(null);

    try {
      const hints = taskKindHints
        .split(",")
        .map((h) => h.trim())
        .filter(Boolean);

      const resp: GenerateFromPromptResult =
        await stigmerRef.current.workflow.generateFromPrompt({
          prompt: trimmed,
          org: orgRef.current,
          model: model.trim() || undefined,
          taskKindHints: hints.length > 0 ? hints : undefined,
        });

      setResult({
        yaml: resp.yaml,
        explanation: resp.explanation,
        warnings: resp.warnings,
        modelUsed: resp.modelUsed,
      });
    } catch (err) {
      const message = getUserMessage(err, "Failed to generate workflow");
      setError(message);
      onErrorRef.current?.(message);
    } finally {
      setIsGenerating(false);
    }
  }, [isGenerating, prompt, model, taskKindHints]);

  const createWorkflow = useCallback(async () => {
    if (isCreating || !result) return;

    setIsCreating(true);
    setError(null);

    try {
      const input = parseWorkflowYaml(result.yaml, orgRef.current);
      const workflow = await stigmerRef.current.workflow.apply(input);

      const slug = workflow.metadata?.slug;
      const workflowOrg = workflow.metadata?.org || orgRef.current;

      if (!slug) {
        throw new Error(
          "Workflow was created but no slug was returned. Check the workflows list.",
        );
      }

      onSuccessRef.current(workflowOrg, slug);
    } catch (err) {
      const message = getUserMessage(err, "Failed to create workflow");
      setError(message);
      onErrorRef.current?.(message);
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, result]);

  const reset = useCallback(() => {
    setPrompt("");
    setModel("");
    setTaskKindHints("");
    setIsGenerating(false);
    setIsCreating(false);
    setResult(null);
    setError(null);
  }, []);

  return {
    prompt,
    setPrompt,
    model,
    setModel,
    taskKindHints,
    setTaskKindHints,
    isGenerating,
    isCreating,
    result,
    error,
    generate,
    createWorkflow,
    reset,
  };
}
