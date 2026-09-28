"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { BillingSection } from "@stigmer/react";

/**
 * Billing settings. Stripe returns here: `?checkout=success` after a
 * credit pack, `?setup=success&plan=<id>` after a card was saved on the
 * way to a plan, which the section reopens for an explicit confirm.
 */
export default function BillingPage() {
  const searchParams = useSearchParams();

  const checkoutSuccess = useMemo(
    () => searchParams.get("checkout") === "success",
    [searchParams],
  );
  const resumePlanId = useMemo(
    () =>
      searchParams.get("setup") === "success"
        ? (searchParams.get("plan") ?? undefined)
        : undefined,
    [searchParams],
  );

  const clearQuery = useCallback(() => {
    const url = new URL(window.location.href);
    window.history.replaceState({}, "", url.pathname);
  }, []);

  return (
    <BillingSection
      checkoutSuccess={checkoutSuccess}
      onDismissCheckoutSuccess={clearQuery}
      resumePlanId={resumePlanId}
      onResumeHandled={clearQuery}
    />
  );
}
