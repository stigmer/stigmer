"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getUserMessage, type RefineWorkflowResult } from "@stigmer/sdk";
import { useStigmer } from "../hooks";

/** Result from a successful workflow refinement. */
export interface RefineWorkflowFlowResult {
  /** Updated workflow YAML incorporating the requested changes. */
  readonly yaml: string;
  /** Human-readable explanation of what was changed and why. */
  readonly explanation: string;
  /** Non-fatal validation warnings (empty when clean). */
  readonly warnings: readonly string[];
  /** The LLM model that was used for refinement. */
  readonly modelUsed: string;
}

/** A single turn in the refinement conversation history (UI-only). */
export interface RefinementHistoryEntry {
  /** The instruction the user provided. */
  readonly instruction: string;
  /** The LLM's explanation of what it changed. */
  readonly explanation: string;
}

/** Options for {@link useRefineWorkflowFlow}. */
export interface UseRefineWorkflowFlowOptions {
  /** Organization slug — used for resource context. */
  readonly org: string;
  /**
   * Called when refinement fails. Receives a human-readable message.
   * Errors are also available via {@link UseRefineWorkflowFlowReturn.error}.
   */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useRefineWorkflowFlow}. */
export interface UseRefineWorkflowFlowReturn {
  /** `true` while the refinement RPC is in flight. */
  readonly isRefining: boolean;

  /** Refinement result, or `null` if not yet refined. */
  readonly result: RefineWorkflowFlowResult | null;
  /** Error from the last failed operation, or `null`. */
  readonly error: string | null;

  /**
   * Accumulated refinement turns for visual reference.
   * Never sent to the server — the current YAML already embodies all changes.
   */
  readonly history: readonly RefinementHistoryEntry[];

  /**
   * Send a refinement instruction along with the current YAML.
   * On success, sets {@link result}. On failure, sets {@link error}.
   */
  readonly refine: (instruction: string, currentYaml: string) => Promise<void>;
  /** Clear the current result and error (preserves history). */
  readonly reset: () => void;
  /** Clear the conversation history. */
  readonly clearHistory: () => void;
}

const MIN_INSTRUCTION_LENGTH = 5;

/**
 * Behavior hook that orchestrates the "refine workflow with AI" flow.
 *
 * Stateless by design — each refinement sends only the current YAML and the
 * instruction. The hook maintains a UI-only conversation history so the user
 * can see previous turns without sending them to the server.
 *
 * This hook is framework-agnostic — it works identically in Next.js,
 * Vite, Tauri, or any React environment.
 *
 * @example
 * ```tsx
 * const flow = useRefineWorkflowFlow({ org: "acme" });
 *
 * <textarea placeholder="What would you like to change?" ... />
 * <button onClick={() => flow.refine(instruction, currentYaml)}>Refine</button>
 * ```
 */
export function useRefineWorkflowFlow(
  options: UseRefineWorkflowFlowOptions,
): UseRefineWorkflowFlowReturn {
  const { org, onError } = options;
  const stigmer = useStigmer();

  const [isRefining, setIsRefining] = useState(false);
  const [result, setResult] = useState<RefineWorkflowFlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<RefinementHistoryEntry[]>([]);

  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const orgRef = useRef(org);
  orgRef.current = org;

  const refine = useCallback(
    async (instruction: string, currentYaml: string) => {
      if (isRefining) return;

      const trimmedInstruction = instruction.trim();
      if (trimmedInstruction.length < MIN_INSTRUCTION_LENGTH) {
        const msg = `Instruction must be at least ${MIN_INSTRUCTION_LENGTH} characters`;
        setError(msg);
        return;
      }

      if (!currentYaml.trim()) {
        const msg = "No workflow YAML to refine";
        setError(msg);
        return;
      }

      setIsRefining(true);
      setError(null);
      setResult(null);

      try {
        const resp: RefineWorkflowResult =
          await stigmerRef.current.workflow.refine({
            currentYaml: currentYaml.trim(),
            instruction: trimmedInstruction,
            org: orgRef.current,
          });

        const flowResult: RefineWorkflowFlowResult = {
          yaml: resp.yaml,
          explanation: resp.explanation,
          warnings: resp.warnings,
          modelUsed: resp.modelUsed,
        };

        setResult(flowResult);
        setHistory((prev) => [
          ...prev,
          { instruction: trimmedInstruction, explanation: resp.explanation },
        ]);
      } catch (err) {
        const message = getUserMessage(err, "Failed to refine workflow");
        setError(message);
        onErrorRef.current?.(message);
      } finally {
        setIsRefining(false);
      }
    },
    [isRefining],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return useMemo(
    () => ({
      isRefining,
      result,
      error,
      history,
      refine,
      reset,
      clearHistory,
    }),
    [isRefining, result, error, history, refine, reset, clearHistory],
  );
}
