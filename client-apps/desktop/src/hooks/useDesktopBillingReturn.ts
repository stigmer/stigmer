import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";

/**
 * Payload of the `billing-return` Tauri event, emitted by the
 * `stigmer://billing/return` deep link handler in `lib.rs` when Stripe
 * hands a person back through the web console's desktop bridge.
 */
export interface BillingReturnPayload {
  readonly setup?: string | null;
  readonly plan?: string | null;
  readonly checkout?: string | null;
}

/**
 * The billing route a return lands on, with the outcome the billing page
 * understands: `?setup=success&plan=<id>` reopens the plan the card was
 * saved for, `?checkout=success` confirms a credit pack. Anything else in
 * the link is dropped; the state itself is read from the server.
 */
export function billingReturnPath(payload: BillingReturnPayload): string {
  const query = new URLSearchParams();
  if (payload.setup === "success") {
    query.set("setup", "success");
    if (payload.plan && /^[A-Za-z0-9_-]{1,64}$/.test(payload.plan)) {
      query.set("plan", payload.plan);
    }
  }
  if (payload.checkout === "success") {
    query.set("checkout", "success");
  }
  const search = query.toString();
  return `/settings/billing${search === "" ? "" : `?${search}`}`;
}

/**
 * Brings the person back to Billing when Stripe returns them to the app.
 *
 * Desktop opens Stripe's pages in the system browser (the billing page's
 * `BillingRedirect`). Stripe returns to the web console's public desktop
 * bridge, which reopens the app through `stigmer://billing/return`; this
 * hook, mounted once in the app shell, routes to the billing page with the
 * outcome, so a saved card reopens the plan being chosen instead of asking
 * for it again. It follows `useDesktopGitHubConnection`'s event listener.
 */
export function useDesktopBillingReturn(): void {
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const unlistenPromise = listen<BillingReturnPayload>("billing-return", (event) => {
      if (cancelled) return;
      navigate(billingReturnPath(event.payload));
    });
    return () => {
      cancelled = true;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [navigate]);
}
