"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { getUserMessage, type DiagnoseExecutionResult } from "@stigmer/sdk";
import { useStigmer } from "../hooks";

/** Result from a successful workflow execution diagnosis. */
export interface DiagnoseExecutionFlowResult {
  /** Root-cause analysis of the failure. Always populated. */
  readonly diagnosis: string;
  /** Corrected workflow YAML (empty for runtime errors). */
  readonly suggestedYaml: string;
  /** Explanation of YAML changes (empty when suggestedYaml is empty). */
  readonly fixExplanation: string;
  /** Validation warnings on the suggested YAML. */
  readonly warnings: readonly string[];
  /** The LLM model that was used. */
  readonly modelUsed: string;
}

/** Options for {@link useDiagnoseExecution}. */
export interface UseDiagnoseExecutionOptions {
  /** Organization slug — used for authorization and resource context. */
  readonly org: string;
  /**
   * Called when diagnosis fails. Receives a human-readable message.
   * Errors are also available via {@link UseDiagnoseExecutionReturn.error}.
   */
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useDiagnoseExecution}. */
export interface UseDiagnoseExecutionReturn {
  /** `true` while the diagnosis RPC is in flight. */
  readonly isDiagnosing: boolean;
  /** Diagnosis result, or `null` if not yet diagnosed. */
  readonly result: DiagnoseExecutionFlowResult | null;
  /** Error from the last failed operation, or `null`. */
  readonly error: string | null;
  /** Whether the diagnosis produced a YAML fix suggestion. */
  readonly hasFix: boolean;

  /**
   * Trigger diagnosis for a given execution ID.
   * On success, sets {@link result}. On failure, sets {@link error}.
   */
  readonly diagnose: (executionId: string) => Promise<void>;
  /** Clear the current result and error. */
  readonly reset: () => void;
}

/**
 * Behavior hook that orchestrates the "diagnose failed execution with AI" flow.
 *
 * Calls the `diagnoseWorkflowExecution` RPC and manages loading/result/error
 * state. The result distinguishes definition errors (with a suggested YAML
 * fix) from runtime errors (diagnosis only, no YAML change).
 *
 * This hook is framework-agnostic — it works identically in Next.js,
 * Vite, Tauri, or any React environment.
 *
 * @example
 * ```tsx
 * const diagnosis = useDiagnoseExecution({ org: "acme" });
 *
 * <button onClick={() => diagnosis.diagnose(executionId)}>
 *   Diagnose with AI
 * </button>
 * ```
 */
export function useDiagnoseExecution(
  options: UseDiagnoseExecutionOptions,
): UseDiagnoseExecutionReturn {
  const { org, onError } = options;
  const stigmer = useStigmer();

  const [isDiagnosing, setIsDiagnosing] = useState(false);
  const [result, setResult] = useState<DiagnoseExecutionFlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stigmerRef = useRef(stigmer);
  stigmerRef.current = stigmer;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const orgRef = useRef(org);
  orgRef.current = org;

  const diagnose = useCallback(
    async (executionId: string) => {
      if (isDiagnosing) return;

      if (!executionId.trim()) {
        const msg = "Execution ID is required";
        setError(msg);
        return;
      }

      setIsDiagnosing(true);
      setError(null);
      setResult(null);

      try {
        const resp: DiagnoseExecutionResult =
          await stigmerRef.current.workflow.diagnoseExecution({
            executionId: executionId.trim(),
            org: orgRef.current,
          });

        const flowResult: DiagnoseExecutionFlowResult = {
          diagnosis: resp.diagnosis,
          suggestedYaml: resp.suggestedYaml,
          fixExplanation: resp.fixExplanation,
          warnings: resp.warnings,
          modelUsed: resp.modelUsed,
        };

        setResult(flowResult);
      } catch (err) {
        const message = getUserMessage(err, "Failed to diagnose execution");
        setError(message);
        onErrorRef.current?.(message);
      } finally {
        setIsDiagnosing(false);
      }
    },
    [isDiagnosing],
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const hasFix = result != null && result.suggestedYaml.length > 0;

  return useMemo(
    () => ({
      isDiagnosing,
      result,
      error,
      hasFix,
      diagnose,
      reset,
    }),
    [isDiagnosing, result, error, hasFix, diagnose, reset],
  );
}
