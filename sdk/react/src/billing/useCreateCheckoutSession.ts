"use client";

import { useCallback, useState } from "react";
import type { CreateCreditCheckoutSessionResponse } from "@stigmer/protos/ai/stigmer/billing/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { leaveForStripe, type BillingRedirect } from "./redirect.js";

/** Parameters for {@link useCreateCheckoutSession}'s `createSession` callback. */
export interface CreateCheckoutSessionInput {
  /** Organization purchasing credits. */
  readonly orgId: string;
  /** Credit pack to purchase: its id, e.g. "starter", "growth" or "team" (the pack named Scale). */
  readonly packId: string;
  /** URL to redirect to after successful payment. */
  readonly successUrl: string;
  /** URL to redirect to if the user cancels checkout. */
  readonly cancelUrl: string;
}

/** Return value of {@link useCreateCheckoutSession}. */
export interface UseCreateCheckoutSessionReturn {
  /**
   * Create a Stripe Checkout Session and redirect the user.
   *
   * On success, leaves for the Stripe-hosted checkout page: through the
   * hook's `redirect.openUrl` when given, else by navigating this window.
   * The promise resolves with the response before the redirect occurs,
   * allowing callers to perform cleanup if needed.
   */
  readonly createSession: (
    input: CreateCheckoutSessionInput,
  ) => Promise<CreateCreditCheckoutSessionResponse>;
  /** `true` while the checkout session is being created. */
  readonly isSubmitting: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that creates a Stripe Checkout Session for credit
 * pack purchases.
 *
 * Wraps `billing.createCreditCheckoutSession` with loading and error
 * state management. On success, redirects the user to the Stripe-hosted
 * checkout page. Credits are provisioned asynchronously via webhook
 * after payment succeeds.
 *
 * @example
 * ```tsx
 * const { createSession, isSubmitting, error } = useCreateCheckoutSession();
 *
 * const handleBuy = () => {
 *   createSession({
 *     orgId,
 *     packId: "growth",
 *     successUrl: `${window.location.origin}/settings/billing?checkout=success`,
 *     cancelUrl: `${window.location.origin}/settings/billing`,
 *   });
 * };
 * ```
 */
export function useCreateCheckoutSession(
  redirect?: BillingRedirect,
): UseCreateCheckoutSessionReturn {
  const stigmer = useStigmer();
  const openUrl = redirect?.openUrl;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const createSession = useCallback(
    async (
      input: CreateCheckoutSessionInput,
    ): Promise<CreateCreditCheckoutSessionResponse> => {
      setIsSubmitting(true);
      setError(null);

      try {
        const response = await stigmer.billing.createCreditCheckoutSession({
          orgId: input.orgId,
          packId: input.packId,
          successUrl: input.successUrl,
          cancelUrl: input.cancelUrl,
        });

        if (response.checkoutUrl) {
          await leaveForStripe(response.checkoutUrl, { openUrl });
        }

        return response;
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [stigmer, openUrl],
  );

  return { createSession, isSubmitting, error, clearError };
}
