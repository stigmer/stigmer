// The desktop billing bridge's deep link (the outcome a Stripe return
// carries, and nothing else) and the line its page shows.

import { describe, expect, it } from "vitest";
import { desktopBillingDeepLink, desktopBillingOutcome } from "../billing-return";

const link = (query: string) => desktopBillingDeepLink(new URLSearchParams(query));

describe("desktopBillingDeepLink", () => {
  it("carries a saved card and the plan it was for", () => {
    expect(link("setup=success&plan=pln_team")).toBe("stigmer://billing/return?setup=success&plan=pln_team");
  });

  it("opens Billing with nothing to resume after a cancel or the portal", () => {
    expect(link("")).toBe("stigmer://billing/return");
  });

  it("drops what the app does not understand", () => {
    expect(link("setup=success&plan=a%2Fb&next=https://evil.example")).toBe("stigmer://billing/return?setup=success");
    expect(link("setup=later&checkout=success")).toBe("stigmer://billing/return");
  });
});

describe("desktopBillingOutcome", () => {
  it("says the card is saved after a setup, and that nothing changed otherwise", () => {
    expect(desktopBillingOutcome(new URLSearchParams("setup=success&plan=pln_team"))).toBe("Your card is saved.");
    expect(desktopBillingOutcome(new URLSearchParams(""))).toBe("Nothing was changed.");
    expect(desktopBillingOutcome(new URLSearchParams("checkout=success"))).toBe("Nothing was changed.");
  });
});
