"use client";

import { useCallback, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { billingReturnUrl, leaveForStripe, type BillingRedirect } from "./redirect.js";

/** Return value of {@link useCreateBillingPortalSession}. */
export interface UseCreateBillingPortalSessionReturn {
  /**
   * Open the Stripe Customer Portal for payment method management.
   *
   * On success, leaves for the Stripe-hosted portal page: through
   * `redirect.openUrl` when given, else by navigating this window. The
   * portal returns to `redirect.returnUrl` when given, else to the page
   * the person is on.
   */
  readonly openPortal: (org: string) => Promise<void>;
  /** `true` while the portal session is being created. */
  readonly isLoading: boolean;
  /** Error from the last failed attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that opens the Stripe Customer Portal for payment
 * method management.
 *
 * Wraps `billing.createBillingPortalSession` with loading and error
 * state management. On success, redirects the user to the Stripe-hosted
 * portal. Payment method changes are synced back via webhooks.
 *
 * @example
 * ```tsx
 * const { openPortal, isLoading } = useCreateBillingPortalSession();
 *
 * <button onClick={() => openPortal(org)} disabled={isLoading}>
 *   Manage payment methods
 * </button>
 * ```
 */
export function useCreateBillingPortalSession(
  redirect?: BillingRedirect,
): UseCreateBillingPortalSessionReturn {
  const stigmer = useStigmer();
  const openUrl = redirect?.openUrl;
  const pinnedReturnUrl = redirect?.returnUrl;
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const openPortal = useCallback(
    async (org: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const returnUrl =
          pinnedReturnUrl !== undefined
            ? billingReturnUrl({ returnUrl: pinnedReturnUrl })
            : typeof window !== "undefined"
              ? window.location.href
              : "";

        const response = await stigmer.billing.createBillingPortalSession({
          org,
          returnUrl,
        });

        if (response.portalUrl) {
          await leaveForStripe(response.portalUrl, { openUrl });
        }
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [stigmer, openUrl, pinnedReturnUrl],
  );

  return { openPortal, isLoading, error, clearError };
}
