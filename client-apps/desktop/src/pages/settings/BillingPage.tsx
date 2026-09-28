import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { BillingSection, type BillingRedirect } from "@stigmer/react";
import { CONSOLE_URL } from "../../config";

/**
 * Billing settings. The Tauri webview cannot host Stripe's pages (its
 * origin is not a web address Stripe can return to), so checkout, card
 * setup and the billing portal open in the system browser. Stripe returns
 * to the web console's public desktop bridge (`/desktop/billing`), which
 * needs no web sign-in and reopens the app through
 * `stigmer://billing/return`; `useDesktopBillingReturn` routes here with
 * the outcome, so a saved card reopens the plan being chosen. This page's
 * reads also refresh when the window regains focus.
 */
const redirect: BillingRedirect = {
  openUrl: (url) => invoke("open_auth_in_browser", { authUrl: url }),
  returnUrl: `${CONSOLE_URL}/desktop/billing`,
};

export default function BillingPage() {
  const [searchParams, setSearchParams] = useSearchParams();

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
    setSearchParams({}, { replace: true });
  }, [setSearchParams]);

  return (
    <BillingSection
      checkoutSuccess={checkoutSuccess}
      onDismissCheckoutSuccess={clearQuery}
      resumePlanId={resumePlanId}
      onResumeHandled={clearQuery}
      redirect={redirect}
    />
  );
}
