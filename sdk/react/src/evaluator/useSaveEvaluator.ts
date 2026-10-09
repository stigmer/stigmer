"use client";

import { useCallback, useState } from "react";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { evaluatorInputOf, type GradingSettings } from "./grading-settings.js";

/** Return value of {@link useSaveEvaluator}. */
export interface UseSaveEvaluatorReturn {
  /**
   * Save the agent's grading settings: creates the evaluator when the agent
   * has none, otherwise updates it. Resolves with the stored evaluator.
   */
  readonly save: (
    agent: { readonly id: string; readonly org: string },
    settings: GradingSettings,
    existing: Evaluator | null,
  ) => Promise<Evaluator>;
  /** `true` while a write is in flight. */
  readonly isSaving: boolean;
  /** Error from the last failed write, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that writes an agent's {@link Evaluator} through
 * `evaluator.create()` or `evaluator.update()`. Only someone who can edit
 * the agent may; the server's refusal is surfaced as `error`. Turning
 * grading off is a save with `enabled: false`, which keeps this month's
 * spend and counts.
 *
 * @example
 * ```tsx
 * const { save, isSaving } = useSaveEvaluator();
 * await save({ id: agentId, org }, { ...settings, enabled: true }, evaluator);
 * ```
 */
export function useSaveEvaluator(): UseSaveEvaluatorReturn {
  const stigmer = useStigmer();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const save = useCallback<UseSaveEvaluatorReturn["save"]>(
    async (agent, settings, existing) => {
      setIsSaving(true);
      setError(null);
      try {
        const input = evaluatorInputOf(agent, settings, existing);
        return existing === null
          ? await stigmer.evaluator.create(input)
          : await stigmer.evaluator.update(input);
      } catch (err) {
        const failure = toError(err);
        setError(failure);
        throw failure;
      } finally {
        setIsSaving(false);
      }
    },
    [stigmer],
  );

  return { save, isSaving, error, clearError };
}
