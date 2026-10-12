// Where a return from Stripe lands in the app: the billing page with only
// the outcome it understands (a saved card and the plan it was for), and
// nothing else a link could carry.

import { describe, expect, it } from "vitest";
import { billingReturnPath, type BillingReturnPayload } from "../useDesktopBillingReturn";

describe("billingReturnPath", () => {
  it("reopens the plan a saved card was for", () => {
    expect(billingReturnPath({ setup: "success", plan: "pln_01m3mn1sx1rj5kr1xw6nrzsrba" })).toBe(
      "/settings/billing?setup=success&plan=pln_01m3mn1sx1rj5kr1xw6nrzsrba",
    );
  });

  it("lands on Billing with nothing to resume after a cancel or the portal", () => {
    expect(billingReturnPath({})).toBe("/settings/billing");
    expect(billingReturnPath({ setup: null, plan: null })).toBe("/settings/billing");
  });

  it("drops what it does not understand", () => {
    expect(billingReturnPath({ setup: "maybe", plan: "pln_team" })).toBe("/settings/billing");
    expect(billingReturnPath({ setup: "success", plan: "../../etc?x=1" })).toBe("/settings/billing?setup=success");
    const stalePack: BillingReturnPayload & { readonly checkout: string } = { checkout: "success" };
    expect(billingReturnPath(stalePack)).toBe("/settings/billing");
  });
});
