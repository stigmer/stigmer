"use client";

import { useCallback, useState } from "react";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import type { BillingAccount } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";

/** Input for {@link useSetAutoRechargeConfig}. */
export interface SetAutoRechargeConfigInput {
  /** Organization ID to configure auto-recharge for. */
  readonly orgId: string;
  /** Whether auto-recharge is enabled. */
  readonly enabled: boolean;
  /** Trigger threshold in micro-USD. */
  readonly thresholdMicros: bigint;
  /** Fixed charge per recharge event in micro-USD. */
  readonly rechargeAmountMicros: bigint;
  /** Maximum monthly auto-recharge spend in micro-USD. */
  readonly monthlyCapMicros: bigint;
}

/** Return value of {@link useSetAutoRechargeConfig}. */
export interface UseSetAutoRechargeConfigReturn {
  /**
   * Save auto-recharge configuration. Returns the updated BillingAccount
   * on success.
   */
  readonly setConfig: (input: SetAutoRechargeConfigInput) => Promise<BillingAccount>;
  /** `true` while the configuration is being saved. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook for configuring auto-recharge settings.
 *
 * Wraps `billing.setAutoRechargeConfig` with loading and error state
 * management. Returns the updated `BillingAccount` on success so the
 * parent can refresh its cached data.
 *
 * @example
 * ```tsx
 * const { setConfig, isSubmitting, error } = useSetAutoRechargeConfig();
 *
 * await setConfig({
 *   orgId,
 *   enabled: true,
 *   thresholdMicros: BigInt(5_000_000),
 *   rechargeAmountMicros: BigInt(50_000_000),
 *   monthlyCapMicros: BigInt(200_000_000),
 * });
 * ```
 */
export function useSetAutoRechargeConfig(): UseSetAutoRechargeConfigReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const setConfig = useCallback(
    async (input: SetAutoRechargeConfigInput): Promise<BillingAccount> => {
      setIsSubmitting(true);
      setError(null);

      try {
        const account = await stigmer.billing.setAutoRechargeConfig({
          orgId: input.orgId,
          enabled: input.enabled,
          thresholdMicros: input.thresholdMicros,
          rechargeAmountMicros: input.rechargeAmountMicros,
          monthlyCapMicros: input.monthlyCapMicros,
        });

        return account;
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer],
  );

  return { setConfig, isSubmitting, error, clearError };
}
