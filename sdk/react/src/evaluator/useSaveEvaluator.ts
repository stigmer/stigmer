"use client";

import { useCallback, useState } from "react";
import type { Evaluator } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { buildEvaluatorProto } from "@stigmer/sdk";
import { toError } from "../internal/toError.js";
import { evaluatorInputOf, type GradingSettings } from "./grading-settings.js";

/** The fields a save of the grading settings changes; the agent it grades stays as stored. */
export const GRADING_SETTING_PATHS: ReadonlyArray<string> = [
  "spec.enabled",
  "spec.sample_rate",
  "spec.monthly_limit_usd",
  "spec.model_name",
];

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
 * `evaluator.create()` or `evaluator.update()`. An update names the
 * grading settings alone ({@link GRADING_SETTING_PATHS}) on the evaluator
 * as loaded, carrying the etag it was read at, so an evaluator changed
 * since it was read refuses the save. Only someone who can edit
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
        if (existing === null) {
          return await stigmer.evaluator.create(input);
        }
        const resource = buildEvaluatorProto(input);
        if (resource.metadata !== undefined) {
          resource.metadata.etag = existing.metadata?.etag ?? "";
        }
        return await stigmer.evaluator.update(resource, [...GRADING_SETTING_PATHS]);
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
