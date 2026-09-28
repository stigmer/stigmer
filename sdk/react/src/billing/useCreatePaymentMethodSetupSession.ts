"use client";

import { useCallback, useMemo, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { billingReturnUrl, leaveForStripe, type BillingRedirect } from "./redirect.js";

/** Return value of {@link useCreatePaymentMethodSetupSession}. */
export interface UseCreatePaymentMethodSetupSessionReturn {
  /**
   * Leave for Stripe's hosted page to save a card, with no charge. Stripe
   * returns to the billing page with `?setup=success` (and `&plan=<id>`
   * when `planId` names the plan the person was subscribing to, so the
   * page can reopen that choice), or without a query when they leave.
   * The saved card becomes the organization's default for every invoice.
   */
  readonly addPaymentMethod: (orgId: string, planId?: string) => Promise<void>;
  /** `true` while the setup session is being created. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behaviour hook that saves a payment method through a Stripe-hosted setup
 * page: the card door every subscription needs before its first period.
 *
 * The caller needs `can_manage_billing` on the organization. Pass the
 * host's {@link BillingRedirect} where the window cannot host Stripe's
 * page itself.
 */
export function useCreatePaymentMethodSetupSession(
  redirect?: BillingRedirect,
): UseCreatePaymentMethodSetupSessionReturn {
  const stigmer = useStigmer();
  const openUrl = redirect?.openUrl;
  const returnUrl = redirect?.returnUrl;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const addPaymentMethod = useCallback(
    async (orgId: string, planId?: string): Promise<void> => {
      setIsSubmitting(true);
      setError(null);
      try {
        const billingPage = billingReturnUrl({ returnUrl });
        const success = new URLSearchParams({ setup: "success" });
        if (planId !== undefined && planId !== "") {
          success.set("plan", planId);
        }
        const response = await stigmer.billing.createPaymentMethodSetupSession({
          orgId,
          successUrl: `${billingPage}?${success.toString()}`,
          cancelUrl: billingPage,
        });
        if (response.setupUrl) {
          await leaveForStripe(response.setupUrl, { openUrl });
        }
      } catch (e) {
        const err = toError(e);
        setError(err);
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer.billing, openUrl, returnUrl],
  );
  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ addPaymentMethod, isSubmitting, error, clearError }),
    [addPaymentMethod, isSubmitting, error, clearError],
  );
}
