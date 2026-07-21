"use client";

import { useCallback, useState } from "react";
import type {
  ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Input for {@link useUpsertModelPricingBaseline}. */
export interface UpsertModelPricingBaselineInput {
  /**
   * The baseline entry to create or revise, keyed by
   * (modelId, provider, harness). Lifecycle fields (baselineId, status,
   * decision stamps, pricing effectiveAt) are server-owned and ignored.
   */
  readonly baseline: ModelPricingBaseline;
  /** Optional operator note recorded on the revision for the audit trail. */
  readonly revisionNote?: string;
}

/** Return value of {@link useUpsertModelPricingBaseline}. */
export interface UseUpsertModelPricingBaselineReturn {
  /**
   * Create or revise a baseline entry. Returns the new revision with
   * server-stamped lifecycle fields.
   */
  readonly upsert: (input: UpsertModelPricingBaselineInput) => Promise<ModelPricingBaseline>;
  /** `true` while a revision is being written. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for creating or revising model registry baseline entries.
 *
 * Wraps `billing.upsertModelPricingBaseline` with loading and error
 * state. The platform recomposes the effective registry immediately, so
 * the parent should refetch its catalog view after a successful upsert.
 *
 * A concurrent-edit conflict surfaces as an ABORTED error telling the
 * operator to reload and re-apply — render it, don't retry silently.
 */
export function useUpsertModelPricingBaseline(): UseUpsertModelPricingBaselineReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const upsert = useCallback(
    async (input: UpsertModelPricingBaselineInput): Promise<ModelPricingBaseline> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.billing.upsertModelPricingBaseline(input);
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.billing],
  );

  const clearError = useCallback(() => setError(null), []);

  return { upsert, isSubmitting, error, clearError };
}
