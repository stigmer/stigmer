// The seam for leaving the app to a Stripe-hosted page: a host's openUrl
// receives the page and this window stays put; without one the window
// navigates; the return page is the host's, else this origin's billing
// settings.

import { afterEach, describe, expect, it, vi } from "vitest";
import { billingReturnUrl, leaveForStripe } from "../redirect";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("billingReturnUrl", () => {
  it("names the host's page when given, else this origin's billing settings", () => {
    expect(billingReturnUrl({ returnUrl: "https://app.stigmer.ai/settings/billing" })).toBe(
      "https://app.stigmer.ai/settings/billing",
    );
    expect(billingReturnUrl(undefined)).toBe(`${window.location.origin}/settings/billing`);
  });
});

describe("leaveForStripe", () => {
  it("hands the page to the host's openUrl and leaves this window where it is", async () => {
    const openUrl = vi.fn().mockResolvedValue(undefined);
    const before = window.location.href;
    await leaveForStripe("https://checkout.stripe.com/c/pay/cs_test", { openUrl });
    expect(openUrl).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test");
    expect(window.location.href).toBe(before);
  });
});
