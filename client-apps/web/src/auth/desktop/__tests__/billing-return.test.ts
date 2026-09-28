// The desktop billing bridge's deep link: the outcome a Stripe return
// carries, and nothing else.

import { describe, expect, it } from "vitest";
import { desktopBillingDeepLink } from "../billing-return";

const link = (query: string) => desktopBillingDeepLink(new URLSearchParams(query));

describe("desktopBillingDeepLink", () => {
  it("carries a saved card and the plan it was for", () => {
    expect(link("setup=success&plan=pln_team")).toBe("stigmer://billing/return?setup=success&plan=pln_team");
  });

  it("carries a completed credit pack", () => {
    expect(link("checkout=success")).toBe("stigmer://billing/return?checkout=success");
  });

  it("opens Billing with nothing to resume after a cancel or the portal", () => {
    expect(link("")).toBe("stigmer://billing/return");
  });

  it("drops what the app does not understand", () => {
    expect(link("setup=success&plan=a%2Fb&next=https://evil.example")).toBe("stigmer://billing/return?setup=success");
    expect(link("setup=later&checkout=failed")).toBe("stigmer://billing/return");
  });
});
