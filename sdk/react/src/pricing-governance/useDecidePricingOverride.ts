"use client";

import { useCallback, useState } from "react";
import type { ModelPricingOverride } from "@stigmer/protos/ai/stigmer/billing/v1/pricing_override_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Input for {@link useDecidePricingOverride}. */
export interface DecidePricingOverrideInput {
  /** The PENDING_SIGNOFF override to decide. */
  readonly overrideId: string;
  /**
   * `true` approves (the override becomes ACTIVE and supersedes any
   * current ACTIVE override on the same pricing key); `false` rejects.
   */
  readonly approve: boolean;
  /** Optional note recorded on the decision for the audit trail. */
  readonly decisionNote?: string;
}

/** Return value of {@link useDecidePricingOverride}. */
export interface UseDecidePricingOverrideReturn {
  /**
   * Decide a pending pricing override. Returns the decided override with
   * the operator's identity stamped.
   */
  readonly decide: (input: DecidePricingOverrideInput) => Promise<ModelPricingOverride>;
  /** `true` while a decision is being recorded. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for deciding PENDING_SIGNOFF pricing overrides from the
 * pricing feedback loop.
 *
 * Wraps `billing.decideModelPricingOverride` with loading and error
 * state. On approval the platform recomposes the effective registry
 * immediately, so the parent should refetch its governance view after a
 * successful decision.
 *
 * @example
 * ```tsx
 * const { decide, isSubmitting } = useDecidePricingOverride();
 *
 * await decide({ overrideId, approve: true, decisionNote: "Verified vs ledger" });
 * refetchGovernance();
 * ```
 */
export function useDecidePricingOverride(): UseDecidePricingOverrideReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const decide = useCallback(
    async (input: DecidePricingOverrideInput): Promise<ModelPricingOverride> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.billing.decideModelPricingOverride(input);
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

  return { decide, isSubmitting, error, clearError };
}
