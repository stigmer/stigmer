"use client";

import { useCallback, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateBillingPortalSession}. */
export interface UseCreateBillingPortalSessionReturn {
  /**
   * Open the Stripe Customer Portal for payment method management.
   *
   * On success, redirects the user to the Stripe-hosted portal page.
   * The promise resolves before the redirect occurs.
   */
  readonly openPortal: (orgId: string) => Promise<void>;
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
 * <button onClick={() => openPortal(orgId)} disabled={isLoading}>
 *   Manage payment methods
 * </button>
 * ```
 */
export function useCreateBillingPortalSession(): UseCreateBillingPortalSessionReturn {
  const stigmer = useStigmer();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const openPortal = useCallback(
    async (orgId: string): Promise<void> => {
      setIsLoading(true);
      setError(null);

      try {
        const returnUrl =
          typeof window !== "undefined" ? window.location.href : "";

        const response = await stigmer.billing.createBillingPortalSession({
          orgId,
          returnUrl,
        });

        if (response.portalUrl) {
          window.location.href = response.portalUrl;
        }
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [stigmer],
  );

  return { openPortal, isLoading, error, clearError };
}
