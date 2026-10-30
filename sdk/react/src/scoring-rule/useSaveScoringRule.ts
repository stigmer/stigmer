"use client";

import { useCallback, useState } from "react";
import type { ScoringRule } from "@stigmer/apis/ai/stigmer/agentic/scoringrule/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { buildScoringRuleProto } from "@stigmer/client";
import { toError } from "@stigmer/react-core/internal";
import { scoringRuleInputOf, type GradingSettings } from "./grading-settings.js";

/** The fields a save of the grading settings changes; the agent it grades stays as stored. */
export const GRADING_SETTING_PATHS: ReadonlyArray<string> = [
  "spec.enabled",
  "spec.sample_rate",
  "spec.monthly_limit_usd",
  "spec.model_name",
];

/** Return value of {@link useSaveScoringRule}. */
export interface UseSaveScoringRuleReturn {
  /**
   * Save the agent's grading settings: creates the scoring rule when the agent
   * has none, otherwise updates it. Resolves with the stored scoring rule.
   */
  readonly save: (
    agent: { readonly id: string; readonly org: string },
    settings: GradingSettings,
    existing: ScoringRule | null,
  ) => Promise<ScoringRule>;
  /** `true` while a write is in flight. */
  readonly isSaving: boolean;
  /** Error from the last failed write, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that writes an agent's {@link ScoringRule} through
 * `scoringrule.create()` or `scoringrule.update()`. An update names the
 * grading settings alone ({@link GRADING_SETTING_PATHS}) on the scoring rule
 * as loaded, carrying the etag it was read at, so a scoring rule changed
 * since it was read refuses the save. Only someone who can edit
 * the agent may; the server's refusal is surfaced as `error`. Turning
 * grading off is a save with `enabled: false`, which keeps this month's
 * spend and counts.
 *
 * @example
 * ```tsx
 * const { save, isSaving } = useSaveScoringRule();
 * await save({ id: agentId, org }, { ...settings, enabled: true }, scoringRule);
 * ```
 */
export function useSaveScoringRule(): UseSaveScoringRuleReturn {
  const stigmer = useStigmer();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const save = useCallback<UseSaveScoringRuleReturn["save"]>(
    async (agent, settings, existing) => {
      setIsSaving(true);
      setError(null);
      try {
        const input = scoringRuleInputOf(agent, settings, existing);
        if (existing === null) {
          return await stigmer.scoringrule.create(input);
        }
        const resource = buildScoringRuleProto(input);
        if (resource.metadata !== undefined) {
          resource.metadata.etag = existing.metadata?.etag ?? "";
        }
        return await stigmer.scoringrule.update(resource, [...GRADING_SETTING_PATHS]);
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
