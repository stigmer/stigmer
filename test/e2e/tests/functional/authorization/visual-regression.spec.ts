import { test, expect } from "@playwright/test";

/**
 * Visual Regression Tests for Authorization Components
 *
 * Captures screenshot baselines for authorization-related UI components
 * in their key states. Uses Playwright's built-in toHaveScreenshot()
 * for pixel-level comparison.
 *
 * Run `npx playwright test --update-snapshots` to regenerate baselines.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 * - Test user has resources with various visibility states
 */

test.describe("Visual Regression - Authorization Components", () => {
  test.describe("Visibility Toggle", () => {
    test("agent visibility toggle - private state", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      if (!(await firstAgent.isVisible())) {
        test.skip();
        return;
      }
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const radiogroup = page.getByRole("radiogroup", {
        name: "Resource visibility",
      });
      if (await radiogroup.isVisible()) {
        await expect(radiogroup).toHaveScreenshot(
          "visibility-toggle-private.png",
          { maxDiffPixelRatio: 0.02 },
        );
      }
    });

    test("visibility toggle - public confirmation prompt", async ({
      page,
    }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      if (!(await firstAgent.isVisible())) {
        test.skip();
        return;
      }
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const radiogroup = page.getByRole("radiogroup", {
        name: "Resource visibility",
      });
      if (!(await radiogroup.isVisible())) {
        test.skip();
        return;
      }

      const publicOption = radiogroup.getByRole("radio", { name: /Public/i });
      await publicOption.click();

      // Capture the toggle + confirmation prompt together
      const container = radiogroup.locator("..");
      await expect(container).toHaveScreenshot(
        "visibility-toggle-confirm-public.png",
        { maxDiffPixelRatio: 0.02 },
      );
    });
  });

  test.describe("Instance Visibility Selector", () => {
    test("3-way selector in default state", async ({ page }) => {
      await page.goto("/library/workflows");
      await page.waitForLoadState("networkidle");

      const firstWorkflow = page
        .locator('[role="listitem"]')
        .first();
      if (!(await firstWorkflow.isVisible())) {
        test.skip();
        return;
      }
      await firstWorkflow.click();
      await page.waitForLoadState("networkidle");

      const radiogroup = page.getByRole("radiogroup", {
        name: "Instance visibility",
      });
      if (await radiogroup.isVisible()) {
        const container = radiogroup.locator("..");
        await expect(container).toHaveScreenshot(
          "instance-visibility-selector-default.png",
          { maxDiffPixelRatio: 0.02 },
        );
      }
    });
  });

  test.describe("Share Panel", () => {
    test("share panel with access list", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      if (!(await firstAgent.isVisible())) {
        test.skip();
        return;
      }
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const shareButton = page.getByRole("button", { name: /share/i });
      if (!(await shareButton.isVisible())) {
        test.skip();
        return;
      }
      await shareButton.click();

      const sharePanel = page.getByRole("region", {
        name: "Resource access management",
      });
      await expect(sharePanel).toBeVisible();

      // Wait for the access list to load
      await page.waitForTimeout(500);

      await expect(sharePanel).toHaveScreenshot("share-panel-loaded.png", {
        maxDiffPixelRatio: 0.02,
      });
    });

    test("share panel with grant form expanded", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      if (!(await firstAgent.isVisible())) {
        test.skip();
        return;
      }
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const shareButton = page.getByRole("button", { name: /share/i });
      if (!(await shareButton.isVisible())) {
        test.skip();
        return;
      }
      await shareButton.click();

      const addButton = page.getByRole("button", { name: /Add people/i });
      if (await addButton.isVisible()) {
        await addButton.click();

        const sharePanel = page.getByRole("region", {
          name: "Resource access management",
        });
        await expect(sharePanel).toHaveScreenshot(
          "share-panel-grant-form.png",
          { maxDiffPixelRatio: 0.02 },
        );
      }
    });
  });

  test.describe("Organization Members Panel", () => {
    test("members page with populated list", async ({ page }) => {
      await page.goto("/settings/members");
      await page.waitForLoadState("networkidle");

      // Wait for member list to render
      await page.waitForTimeout(1000);

      const mainContent = page.locator("main");
      await expect(mainContent).toHaveScreenshot("org-members-panel.png", {
        maxDiffPixelRatio: 0.02,
      });
    });
  });
});
