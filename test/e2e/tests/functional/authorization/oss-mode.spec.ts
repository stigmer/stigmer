import { test, expect } from "@playwright/test";

/**
 * OSS Mode Authorization Tests
 *
 * Verifies that authorization-specific UI is correctly absent when
 * running against the OSS server edition (no FGA, no IAM service).
 *
 * Key behaviors in OSS:
 * - Visibility toggles for blueprints (private/public) remain visible
 *   (they update metadata in SQLite without FGA)
 * - Organization members / invitations pages show CloudFeatureNotice
 * - Share buttons are absent (no IAM policy service)
 * - Instance visibility selector is absent (requires FGA for enforcement)
 * - All actions (edit, delete, run) are always enabled (no permission checks)
 *
 * Prerequisites:
 * - Running against OSS stigmer-server (not cloud)
 */

test.describe("OSS Mode - Authorization UI", () => {
  test.skip(
    !!process.env.STIGMER_E2E_CLOUD,
    "These tests validate OSS-specific behavior",
  );

  test("settings/members shows cloud feature notice", async ({ page }) => {
    await page.goto("/settings/members");
    await page.waitForLoadState("networkidle");

    // In OSS mode, the members page should indicate it's cloud-only
    const notice = page.getByText(/cloud|not available|local mode/i);
    await expect(notice).toBeVisible();
  });

  test("settings/invitations shows cloud feature notice", async ({ page }) => {
    await page.goto("/settings/invitations");
    await page.waitForLoadState("networkidle");

    const notice = page.getByText(/cloud|not available|local mode/i);
    await expect(notice).toBeVisible();
  });

  test("agent detail has visibility toggle in OSS", async ({ page }) => {
    await page.goto("/library/agents");
    await page.waitForLoadState("networkidle");

    const firstAgent = page.locator('[role="listitem"]').first();
    if (await firstAgent.isVisible()) {
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      // Visibility toggle works in OSS (metadata-only, no FGA)
      const radiogroup = page.getByRole("radiogroup", {
        name: "Resource visibility",
      });
      await expect(radiogroup).toBeVisible();
    }
  });

  test("agent detail does NOT have share button in OSS", async ({ page }) => {
    await page.goto("/library/agents");
    await page.waitForLoadState("networkidle");

    const firstAgent = page.locator('[role="listitem"]').first();
    if (await firstAgent.isVisible()) {
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      // Share requires IAM service which doesn't exist in OSS
      const shareButton = page.getByRole("button", { name: /share/i });
      await expect(shareButton).not.toBeVisible();
    }
  });

  test("no instance visibility selector in OSS", async ({ page }) => {
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");

    const firstWorkflow = page
      .locator('[role="listitem"]')
      .first();
    if (await firstWorkflow.isVisible()) {
      await firstWorkflow.click();
      await page.waitForLoadState("networkidle");

      // Instance visibility selector should NOT appear in OSS
      // (requires FGA for enforcement)
      const instanceSelector = page.getByRole("radiogroup", {
        name: "Instance visibility",
      });
      await expect(instanceSelector).not.toBeVisible();
    }
  });
});
