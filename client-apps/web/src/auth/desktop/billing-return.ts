/**
 * The deep link that hands a Stigmer Desktop user back to the app after a
 * Stripe page (`app/desktop/billing`). It carries only the outcomes the
 * app's billing page understands, a saved card with the plan it was for
 * or a completed credit pack, and drops anything else in the return URL:
 * the state itself is read from the server.
 */
export function desktopBillingDeepLink(searchParams: URLSearchParams): string {
  const query = new URLSearchParams();
  if (searchParams.get("setup") === "success") {
    query.set("setup", "success");
    const plan = searchParams.get("plan") ?? "";
    if (/^[A-Za-z0-9_-]{1,64}$/.test(plan)) query.set("plan", plan);
  }
  if (searchParams.get("checkout") === "success") {
    query.set("checkout", "success");
  }
  const search = query.toString();
  return `stigmer://billing/return${search === "" ? "" : `?${search}`}`;
}
