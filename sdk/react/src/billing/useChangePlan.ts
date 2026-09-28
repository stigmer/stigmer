"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Subscription } from "@stigmer/protos/ai/stigmer/billing/subscription/v1/api_pb";
import {
  CancelSubscriptionInputSchema,
  ChangePlanInputSchema,
} from "@stigmer/protos/ai/stigmer/billing/subscription/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useChangePlan}. */
export interface UseChangePlanReturn {
  /**
   * Move the organization onto a plan: subscribe (from Free), switch, or
   * resume a canceled plan by choosing it again. A switch takes effect
   * now: the current period closes early, billed for the time it ran, and
   * a new monthly period opens on the new plan. Nothing is charged at the
   * moment of the change; every period is collected when it closes.
   *
   * Refused with the `PAYMENT_METHOD_REQUIRED` reason when the
   * organization has no saved card (see
   * {@link useCreatePaymentMethodSetupSession}). Resolves with the
   * subscription as it stands after the change.
   */
  readonly changePlan: (orgId: string, planId: string) => Promise<Subscription>;
  /** `true` while a change is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that moves an organization onto a plan.
 *
 * The caller needs `can_manage_billing` on the organization (its admins).
 * Refetch the subscription, entitlements and estimate after a change.
 */
export function useChangePlan(): UseChangePlanReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const changePlan = useCallback(
    async (orgId: string, planId: string): Promise<Subscription> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.subscription.changePlan(create(ChangePlanInputSchema, { orgId, planId }));
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.subscription],
  );
  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ changePlan, isSubmitting, error, clearError }),
    [changePlan, isSubmitting, error, clearError],
  );
}

/** Return value of {@link useCancelSubscription}. */
export interface UseCancelSubscriptionReturn {
  /**
   * Cancel the organization's subscription. It keeps its plan to the end
   * of the current period and is on Free after it; nothing it built is
   * deleted. Choosing the same plan again before then resumes it.
   */
  readonly cancel: (orgId: string) => Promise<Subscription>;
  /** `true` while a cancel is in flight. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that cancels an organization's subscription at the end
 * of its period. The caller needs `can_manage_billing` on the organization.
 */
export function useCancelSubscription(): UseCancelSubscriptionReturn {
  const stigmer = useStigmer();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const cancel = useCallback(
    async (orgId: string): Promise<Subscription> => {
      setIsSubmitting(true);
      setError(null);
      try {
        return await stigmer.subscription.cancel(create(CancelSubscriptionInputSchema, { orgId }));
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.subscription],
  );
  const clearError = useCallback(() => setError(null), []);

  return useMemo(() => ({ cancel, isSubmitting, error, clearError }), [cancel, isSubmitting, error, clearError]);
}
