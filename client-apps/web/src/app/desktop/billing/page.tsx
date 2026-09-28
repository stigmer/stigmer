"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { desktopBillingDeepLink } from "@/auth/desktop/billing-return";

/**
 * Where Stripe returns a Stigmer Desktop user after a card, a credit pack
 * or the billing portal, and the hand-off back to the app.
 *
 * Desktop opens Stripe's pages in the system browser, whose web session is
 * not the app's, so the return must not ask for a sign-in: this route is
 * public (`PUBLIC_ROUTES` in `providers/Providers.tsx`). The page reopens
 * the app through `stigmer://billing/return`, carrying only the outcome
 * Stripe was sent back with, and the app's billing page picks up from
 * there: a saved card reopens the plan the person was choosing. The state
 * itself lives on the server; the query carries nothing it can be trusted
 * for. It follows the GitHub desktop bridge (`auth/github/callback`).
 */
export default function DesktopBillingReturnPage() {
  return (
    <Suspense fallback={null}>
      <DesktopBillingBridge />
    </Suspense>
  );
}

function DesktopBillingBridge() {
  const searchParams = useSearchParams();
  const deepLink = desktopBillingDeepLink(new URLSearchParams(searchParams.toString()));
  const outcome =
    searchParams.get("setup") === "success"
      ? "Your card is saved."
      : searchParams.get("checkout") === "success"
        ? "Your credits are on their way."
        : "Nothing was changed.";

  useEffect(() => {
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <main className="flex h-screen items-center justify-center p-6">
      <div className="max-w-sm space-y-3 text-center">
        <h1 className="text-base font-medium">{outcome}</h1>
        <p className="text-muted-foreground text-sm">
          Return to Stigmer Desktop to continue. You can close this tab.
        </p>
        <a
          href={deepLink}
          className="text-primary inline-block text-sm font-medium hover:underline"
        >
          Open Stigmer Desktop
        </a>
      </div>
    </main>
  );
}
