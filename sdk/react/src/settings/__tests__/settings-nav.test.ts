import { describe, it, expect } from "vitest";
import { SETTINGS_NAV_GROUPS } from "../settings-nav";

// The nav model is the single source for the sidebar AND both client-app
// landing grids — these entries disappearing would silently orphan the
// preference pages everywhere at once.
describe("SETTINGS_NAV_GROUPS preference entries", () => {
  it("lists org preferences in the Organization group", () => {
    const organization = SETTINGS_NAV_GROUPS.find(
      (g) => g.label === "Organization",
    );
    expect(organization).toBeDefined();
    expect(
      organization!.items.find((i) => i.href === "/settings/org-preferences")
        ?.label,
    ).toBe("Preferences");
  });

  it("lists account preferences in the Account group", () => {
    const account = SETTINGS_NAV_GROUPS.find((g) => g.label === "Account");
    expect(account).toBeDefined();
    expect(
      account!.items.find((i) => i.href === "/settings/account-preferences")
        ?.label,
    ).toBe("Preferences");
  });
});
