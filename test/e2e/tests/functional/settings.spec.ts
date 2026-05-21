import { test, expect } from "@playwright/test";

/**
 * Settings pages structural tests.
 *
 * Verifies that all 12 settings routes render their section heading,
 * do not crash with an error boundary, and show either content or
 * a CloudFeatureNotice (role="status") when running against OSS.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 * - No backend required for structural checks (cloud-gated sections
 *   show CloudFeatureNotice in OSS mode)
 */

const SETTINGS_SECTIONS = [
  {
    path: "/settings/api-keys",
    headingId: "api-keys-heading",
    headingText: "API Keys",
    cloudGated: true,
  },
  {
    path: "/settings/environments",
    headingId: "personal-env-heading",
    headingText: "Personal Environment",
    cloudGated: false,
  },
  {
    path: "/settings/members",
    headingId: "members-heading",
    headingText: "Members",
    cloudGated: true,
  },
  {
    path: "/settings/invitations",
    headingId: "invitations-heading",
    headingText: "Invitations",
    cloudGated: true,
  },
  {
    path: "/settings/identity-providers",
    headingId: "identity-providers-heading",
    headingText: "Identity Providers",
    cloudGated: true,
  },
  {
    path: "/settings/platform-clients",
    headingId: "platform-clients-heading",
    headingText: "Platform Clients",
    cloudGated: true,
  },
  {
    path: "/settings/oauth-apps",
    headingId: "oauth-apps-heading",
    headingText: "OAuth Apps",
    cloudGated: true,
  },
  {
    path: "/settings/org-profile",
    headingId: "org-profile-heading",
    headingText: "Organization Profile",
    cloudGated: false,
  },
  {
    path: "/settings/billing",
    headingId: "billing-heading",
    headingText: "Billing",
    cloudGated: true,
  },
  {
    path: "/settings/usage",
    headingId: "usage-heading",
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

      const sectionHeading = page.locator(`#${section.headingId}`);
      await expect(sectionHeading).toBeVisible({ timeout: 15_000 });
      await expect(sectionHeading).toHaveText(section.headingText);

      await expect(page.getByText("Something went wrong")).toHaveCount(0);
    });
  }

  for (const section of SETTINGS_SECTIONS.filter((s) => s.cloudGated)) {
    test(`${section.headingText} shows content or cloud notice in OSS`, async ({
      page,
    }) => {
      await page.goto(section.path);

      const sectionHeading = page.locator(`#${section.headingId}`);
      await expect(sectionHeading).toBeVisible({ timeout: 15_000 });

      const cloudNotice = page
        .locator(`section[aria-labelledby="${section.headingId}"]`)
        .locator('[role="status"]');
      const sectionContent = page.locator(
        `section[aria-labelledby="${section.headingId}"]`,
      );

      await expect(sectionContent).toBeVisible();
      const hasCloudNotice = await cloudNotice.isVisible();

      if (hasCloudNotice) {
        await expect(cloudNotice).toContainText(/not available in local mode/);
      }
    });
  }
});
