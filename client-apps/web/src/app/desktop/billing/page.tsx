"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { AppHandoffView } from "@stigmer/react-sdk/console";
import { desktopBillingDeepLink, desktopBillingOutcome } from "@/auth/desktop/billing-return";
import { StigmerLogo } from "@/auth/StigmerLogo";

/**
 * Where Stripe returns a Stigmer Desktop user after a card or the billing
 * portal, and the hand-off back to the app.
 *
 * Desktop opens Stripe's pages in the system browser, whose web session is
 * not the app's, so the return must not ask for a sign-in: this route is
 * public (`PUBLIC_ROUTES` in `providers/Providers.tsx`). The page reopens
 * the app through `stigmer://billing/return`, carrying only the outcome
 * Stripe was sent back with, and the app's billing page picks up from
 * there: a saved card reopens the plan the person was choosing. The state
 * itself lives on the server; the query carries nothing it can be trusted
 * for. It follows the sign-in's desktop bridge (`auth/oauth/callback`).
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
  const outcome = desktopBillingOutcome(new URLSearchParams(searchParams.toString()));

  useEffect(() => {
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <AppHandoffView
      mark={<StigmerLogo size={40} />}
      title={outcome}
      lead="Go back to Stigmer Desktop to carry on. You can close this tab."
      href={deepLink}
      actLabel="Open Stigmer Desktop"
    />
  );
}
