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

  it("lists no Policies page: its switch is a section of the organization's preferences", () => {
    const hrefs = SETTINGS_NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("/settings/org-policies");
  });

  it("lists account preferences in the Account group", () => {
    const account = SETTINGS_NAV_GROUPS.find((g) => g.label === "Account");
    expect(account).toBeDefined();
    expect(
      account!.items.find((i) => i.href === "/settings/account-preferences")
        ?.label,
    ).toBe("Preferences");
  });

  it("lists no Notifications page: its switch is a section of the account's preferences", () => {
    const hrefs = SETTINGS_NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => i.href),
    );
    expect(hrefs).not.toContain("/settings/notifications");
  });
});

describe("SETTINGS_NAV_GROUPS words", () => {
  it("spells each page as its own title does, in sentence case", () => {
    const labels = SETTINGS_NAV_GROUPS.flatMap((g) =>
      g.items.map((i) => i.label),
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "Organization profile",
        "API keys",
        "OAuth apps",
        "Channel apps",
        "Federation issuers",
      ]),
    );
    expect(SETTINGS_NAV_GROUPS.map((g) => g.label)).toContain(
      "Billing and usage",
    );
    for (const label of labels) expect(label).not.toMatch(/ [A-Z][a-z]/);
  });

  it("gives every page a line saying what it is for", () => {
    for (const item of SETTINGS_NAV_GROUPS.flatMap((g) => g.items)) {
      expect(item.description, item.href).toMatch(/\.$/);
    }
  });
});
