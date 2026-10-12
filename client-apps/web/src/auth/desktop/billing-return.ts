/**
 * The desktop billing bridge's two pure halves: the deep link that hands a Stigmer Desktop user back to the app after a
 * Stripe page (`app/desktop/billing`). It carries only the outcome the
 * app's billing page understands, a saved card with the plan it was for,
 * and drops anything else in the return URL: the state itself is read
 * from the server. And the one line the bridge's page tells the person
 * while the app reopens.
 */
export function desktopBillingDeepLink(searchParams: URLSearchParams): string {
  const query = new URLSearchParams();
  if (searchParams.get("setup") === "success") {
    query.set("setup", "success");
    const plan = searchParams.get("plan") ?? "";
    if (/^[A-Za-z0-9_-]{1,64}$/.test(plan)) query.set("plan", plan);
  }
  const search = query.toString();
  return `stigmer://billing/return${search === "" ? "" : `?${search}`}`;
}

/** What the bridge's page says: a saved card, or nothing changed (a cancel or the portal). */
export function desktopBillingOutcome(searchParams: URLSearchParams): string {
  return searchParams.get("setup") === "success" ? "Your card is saved." : "Nothing was changed.";
}
