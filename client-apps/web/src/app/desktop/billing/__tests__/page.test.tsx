// ---------------------------------------------------------------------------
// The desktop billing bridge page: it tells the person what became of their
// Stripe visit and reopens Stigmer Desktop on its billing deep link, with a
// link to do the same by hand.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.value),
}));

import DesktopBillingReturnPage from "../page";

beforeEach(() => {
  search.value = "";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the desktop billing bridge", () => {
  it("says the card is saved and reopens the app with the plan it was for", async () => {
    search.value = "?setup=success&plan=pln_team";
    const location = { href: "https://console.example/desktop/billing" };
    vi.stubGlobal("location", location);
    render(<DesktopBillingReturnPage />);
    expect(
      screen.getByRole("heading", { name: "Your card is saved." }),
    ).toBeDefined();
    await waitFor(() =>
      expect(location.href).toBe(
        "stigmer://billing/return?setup=success&plan=pln_team",
      ),
    );
  });

  it("says nothing changed after a cancel or the portal", async () => {
    const location = { href: "https://console.example/desktop/billing" };
    vi.stubGlobal("location", location);
    render(<DesktopBillingReturnPage />);
    expect(
      screen.getByRole("heading", { name: "Nothing was changed." }),
    ).toBeDefined();
    await waitFor(() => expect(location.href).toBe("stigmer://billing/return"));
  });
});
