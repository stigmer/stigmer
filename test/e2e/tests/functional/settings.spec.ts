import { test, expect } from "@playwright/test";

/**
 * Settings pages structural tests.
 *
 * Verifies that the settings routes render their section heading, do not
 * crash with an error boundary, and, for the sections whose behaviour
 * depends on the edition, show exactly the open-source posture: either the
 * section works (its primary control is there), or its notice
 * (role="status") says where the feature is available.
 */

// Sections are located through the accessibility tree: each settings
// section is a <section aria-labelledby={headingId}> whose heading gives it
// an accessible name, i.e. role=region. The heading ids themselves are
// minted per mount with useId() (oss#619) and carry no stable value to
// anchor on — the accessible name is the contract.
/** What an edition-dependent section shows on the open-source server. */
type OssPosture =
  | { readonly notice: string }
  | { readonly works: { readonly role: "button" | "list" | "textbox"; readonly name: string } };

const SETTINGS_SECTIONS: readonly {
  readonly path: string;
  readonly headingText: string;
  readonly oss?: OssPosture;
}[] = [
  {
    path: "/settings/api-keys",
    headingText: "API Keys",
    oss: { works: { role: "button", name: "+ New API key" } },
  },
  {
    path: "/settings/environments",
    headingText: "Personal Environment",
  },
  {
    path: "/settings/members",
    headingText: "Members",
    oss: { works: { role: "list", name: "Organization members" } },
  },
  {
    path: "/settings/teams",
    headingText: "Teams",
    oss: { notice: "Teams are available in Stigmer Enterprise and Cloud." },
  },
  {
    path: "/settings/invitations",
    headingText: "Invitations",
    oss: { notice: "Invitations are not available in local mode." },
  },
  {
    path: "/settings/identity-providers",
    headingText: "Identity Providers",
    oss: { notice: "Identity providers are not available in local mode." },
  },
  {
    path: "/settings/platform-clients",
    headingText: "Platform Clients",
    oss: { notice: "This server trusts every request, so nothing would verify a platform client's tokens" },
  },
  {
    path: "/settings/oauth-apps",
    headingText: "OAuth Apps",
    oss: { works: { role: "button", name: "+ New OAuth app" } },
  },
  {
    path: "/settings/org-profile",
    headingText: "Organization Profile",
  },
  {
    path: "/settings/org-preferences",
    headingText: "Organization Preferences",
  },
  {
    path: "/settings/account-preferences",
    headingText: "Account Preferences",
    oss: { works: { role: "textbox", name: "Standing context" } },
  },
  {
    path: "/settings/memory",
    headingText: "Memory",
  },
  {
    path: "/settings/billing",
    headingText: "Billing",
    oss: { notice: "Credit billing and purchases are available on Stigmer Cloud." },
  },
  {
    path: "/settings/usage",
    headingText: "Usage",
  },
];

test.describe("Settings index", () => {
  test("renders sr-only heading and all group sections", async ({ page }) => {
    await page.goto("/settings");

    const heading = page.locator("h1");
    await expect(heading).toHaveText("Settings", { timeout: 15_000 });

    await expect(
      page.getByRole("heading", { name: "Organization" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Configuration" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Billing & Usage/ }),
    ).toBeVisible();
  });

  test("management sidebar is present with navigation links", async ({
    page,
  }) => {
    await page.goto("/settings");

    const sidebar = page.getByLabel("Management navigation");
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    await expect(sidebar.getByRole("link", { name: "API Keys" })).toBeVisible();
    await expect(
      sidebar.getByRole("link", { name: "Environments" }),
    ).toBeVisible();
    await expect(sidebar.getByRole("link", { name: "Members" })).toBeVisible();

    await expect(
      sidebar.getByRole("link", { name: /Back to Sessions/ }),
    ).toBeVisible();
  });

  test("settings error boundary does not render", async ({ page }) => {
    await page.goto("/settings");

    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText("Something went wrong")).toHaveCount(0);
  });
});

test.describe("Settings sections", () => {
  for (const section of SETTINGS_SECTIONS) {
    test(`${section.headingText} (${section.path}) renders section heading`, async ({
      page,
    }) => {
      await page.goto(section.path);

      // The region only has this accessible name if the heading↔section
      // aria-labelledby association is intact — the same wiring the old
      // literal-id selectors asserted, now checked through semantics.
      const region = page.getByRole("region", { name: section.headingText });
      await expect(region).toBeVisible({ timeout: 15_000 });
      await expect(
        region.getByRole("heading", { name: section.headingText }),
      ).toBeVisible();

      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    });
  }

  test("Organization Preferences carries the memory consent toggle", async ({
    page,
  }) => {
    await page.goto("/settings/org-preferences");

    const region = page.getByRole("region", { name: "Organization Preferences" });
    await expect(region).toBeVisible({ timeout: 15_000 });

    // The org half of the double opt-in (oss#293 Phase 2 Stage 3). In OSS
    // local mode this is the ONLY memory switch (the account scope
    // collapses), so its presence here is load-bearing. Read-only
    // assertion — flipping would mutate the shared local org.
    const memorySwitch = region.getByRole("switch", { name: "Memory" });
    await expect(memorySwitch).toBeVisible();
    await expect(memorySwitch).toHaveAttribute("aria-checked", /true|false/);
    // The transparency helper copy is the switch's accessible description.
    await expect(memorySwitch).toHaveAttribute("aria-describedby", /.+/);
  });

  for (const section of SETTINGS_SECTIONS) {
    const posture = section.oss;
    if (!posture) continue;
    test(`${section.headingText} shows its open-source posture`, async ({ page }) => {
      await page.goto(section.path);

      const region = page.getByRole("region", { name: section.headingText });
      await expect(region).toBeVisible({ timeout: 15_000 });

      if ("notice" in posture) {
        await expect(region.getByRole("status")).toContainText(posture.notice);
      } else {
        await expect(region.getByRole("status")).toHaveCount(0);
        await expect(
          region.getByRole(posture.works.role, { name: posture.works.name }),
        ).toBeVisible();
      }
    });
  }
});
