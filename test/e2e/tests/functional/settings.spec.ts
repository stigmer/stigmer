import { test, expect } from "@playwright/test";

/**
 * Settings pages structural tests.
 *
 * Verifies that the settings routes render their section heading,
 * do not crash with an error boundary, and show either content or
 * a CloudFeatureNotice (role="status") when running against OSS.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 * - No backend required for structural checks (cloud-gated sections
 *   show CloudFeatureNotice in OSS mode)
 */

// Sections are located through the accessibility tree: each settings
// section is a <section aria-labelledby={headingId}> whose heading gives it
// an accessible name, i.e. role=region. The heading ids themselves are
// minted per mount with useId() (oss#619) and carry no stable value to
// anchor on — the accessible name is the contract.
const SETTINGS_SECTIONS = [
  {
    path: "/settings/api-keys",
    headingText: "API Keys",
    cloudGated: true,
  },
  {
    path: "/settings/environments",
    headingText: "Personal Environment",
    cloudGated: false,
  },
  {
    path: "/settings/members",
    headingText: "Members",
    cloudGated: true,
  },
  {
    path: "/settings/invitations",
    headingText: "Invitations",
    cloudGated: true,
  },
  {
    path: "/settings/identity-providers",
    headingText: "Identity Providers",
    cloudGated: true,
  },
  {
    path: "/settings/platform-clients",
    headingText: "Platform Clients",
    cloudGated: true,
  },
  {
    path: "/settings/oauth-apps",
    headingText: "OAuth Apps",
    cloudGated: true,
  },
  {
    path: "/settings/org-profile",
    headingText: "Organization Profile",
    cloudGated: false,
  },
  {
    path: "/settings/org-preferences",
    headingText: "Organization Preferences",
    cloudGated: false,
  },
  {
    path: "/settings/account-preferences",
    headingText: "Account Preferences",
    cloudGated: true,
  },
  {
    path: "/settings/memory",
    headingText: "Memory",
    cloudGated: false,
  },
  {
    path: "/settings/billing",
    headingText: "Billing",
    cloudGated: true,
  },
  {
    path: "/settings/usage",
    headingText: "Usage",
    cloudGated: false,
  },
] as const;

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

  for (const section of SETTINGS_SECTIONS.filter((s) => s.cloudGated)) {
    test(`${section.headingText} shows content or cloud notice in OSS`, async ({
      page,
    }) => {
      await page.goto(section.path);

      const region = page.getByRole("region", { name: section.headingText });
      await expect(region).toBeVisible({ timeout: 15_000 });

      const cloudNotice = region.locator('[role="status"]');
      const hasCloudNotice = await cloudNotice.isVisible();

      if (hasCloudNotice) {
        // The notices' wording varies per section ("not available in local
        // mode", "available on Stigmer Cloud", …) — the durable invariant is
        // that every gating notice points at Stigmer Cloud.
        await expect(cloudNotice).toContainText(/Stigmer Cloud|local mode/);
      }
    });
  }
});
