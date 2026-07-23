"use client";

import { useCallback, useState } from "react";
import type {
  ModelPricingBaseline,
} from "@stigmer/protos/ai/stigmer/billing/v1/model_pricing_baseline_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Input for {@link useRetireModelPricingBaseline}. */
export interface RetireModelPricingBaselineInput {
  readonly modelId: string;
  readonly provider: string;
  readonly harness: string;
  /** Optional operator note recorded on the retirement. */
  readonly revisionNote?: string;
}

/** Return value of {@link useRetireModelPricingBaseline}. */
export interface UseRetireModelPricingBaselineReturn {
  /** Retire a model from the catalog. Returns the RETIRED document. */
  readonly retire: (input: RetireModelPricingBaselineInput) => Promise<ModelPricingBaseline>;
  /** `true` while a retirement is being recorded. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for retiring models from the registry catalog.
 *
 * Wraps `billing.retireModelPricingBaseline` with loading and error
 * state. Retirement removes the model from every price surface on the
 * next composition pass; the document is kept for audit and the key can
 * be revived by a subsequent upsert. The parent should refetch its
 * catalog view after a successful retirement.
 */
export function useRetireModelPricingBaseline(): UseRetireModelPricingBaselineReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const retire = useCallback(
    async (input: RetireModelPricingBaselineInput): Promise<ModelPricingBaseline> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.billing.retireModelPricingBaseline(input);
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

  return { retire, isSubmitting, error, clearError };
}
