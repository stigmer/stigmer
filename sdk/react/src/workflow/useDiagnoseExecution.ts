"use client";

import { useMemo } from "react";

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
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useDiagnoseExecution}. */
export interface UseDiagnoseExecutionReturn {
  readonly isDiagnosing: boolean;
  readonly result: DiagnoseExecutionFlowResult | null;
  readonly error: string | null;
  readonly hasFix: boolean;
  readonly diagnose: (executionId: string) => Promise<void>;
  readonly reset: () => void;
}

const STUB_ERROR =
  "Workflow execution diagnosis is being rebuilt as an agent-powered flow (Batch 5). " +
  "Use the Workflow Architect agent for diagnosis in the meantime.";

/**
 * **Stub** — the direct-LLM diagnosis RPC was removed. This hook will be
 * replaced by an agent-powered diagnosis flow in Batch 5.
 *
 * All type exports are preserved for barrel-export compatibility.
 * Calling `diagnose()` throws a descriptive error.
 */
export function useDiagnoseExecution(
  _options: UseDiagnoseExecutionOptions,
): UseDiagnoseExecutionReturn {
  return useMemo(
    () => ({
      isDiagnosing: false,
      result: null,
      error: STUB_ERROR,
      hasFix: false,
      diagnose: async () => {
        throw new Error(STUB_ERROR);
      },
      reset: () => {},
    }),
    [],
  );
}
