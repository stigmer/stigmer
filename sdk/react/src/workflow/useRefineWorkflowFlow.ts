"use client";

import { useMemo } from "react";

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
  readonly onError?: (message: string) => void;
}

/** Return value of {@link useRefineWorkflowFlow}. */
export interface UseRefineWorkflowFlowReturn {
  readonly isRefining: boolean;
  readonly result: RefineWorkflowFlowResult | null;
  readonly error: string | null;
  readonly history: readonly RefinementHistoryEntry[];
  readonly refine: (instruction: string, currentYaml: string) => Promise<void>;
  readonly reset: () => void;
  readonly clearHistory: () => void;
}

const STUB_ERROR =
  "Workflow refinement is being rebuilt as an agent-powered flow (Batch 4). " +
  "Use the Workflow Architect agent for refinement in the meantime.";

/**
 * **Stub** — the direct-LLM refinement RPC was removed. This hook will be
 * replaced by an agent-powered refinement flow in Batch 4.
 *
 * All type exports are preserved for barrel-export compatibility.
 * Calling `refine()` throws a descriptive error.
 */
export function useRefineWorkflowFlow(
  _options: UseRefineWorkflowFlowOptions,
): UseRefineWorkflowFlowReturn {
  return useMemo(
    () => ({
      isRefining: false,
      result: null,
      error: STUB_ERROR,
      history: [],
      refine: async () => {
        throw new Error(STUB_ERROR);
      },
      reset: () => {},
      clearHistory: () => {},
    }),
    [],
  );
}
