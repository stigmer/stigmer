/**
 * Where a billing flow leaves the app for a Stripe-hosted page, and where
 * Stripe sends the person back.
 *
 * By default the console navigates its own window to Stripe and Stripe
 * returns to the host's billing page on the same origin: right for a web
 * console. A host whose window cannot host a third-party page, such as a
 * desktop webview whose origin is not a web address Stripe can return to,
 * passes a {@link BillingRedirect}: `openUrl` opens the page elsewhere
 * (the system browser), and `returnUrl` names a real web page for Stripe
 * to return to. The person finishes there; the host's reads refresh when
 * its window regains focus, because the state lives on the server.
 */

/** The host's seam for leaving the app to a Stripe-hosted page. */
export interface BillingRedirect {
  /**
   * Opens a Stripe-hosted page. Absent, the current window navigates to
   * it. Desktop hosts open the system browser.
   */
  readonly openUrl?: (url: string) => void | Promise<void>;
  /**
   * The absolute URL of the billing page Stripe returns to, without a
   * query. Absent, the current origin's `/settings/billing`.
   */
  readonly returnUrl?: string;
}

/** The billing page Stripe returns to, per the redirect or the current origin. */
export function billingReturnUrl(redirect: BillingRedirect | undefined): string {
  if (redirect?.returnUrl !== undefined) {
    return redirect.returnUrl;
  }
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/settings/billing`;
}

/** Leaves for a Stripe-hosted page through the redirect, or by navigating this window. */
export async function leaveForStripe(url: string, redirect: BillingRedirect | undefined): Promise<void> {
  if (redirect?.openUrl !== undefined) {
    await redirect.openUrl(url);
    return;
  }
  window.location.href = url;
}
