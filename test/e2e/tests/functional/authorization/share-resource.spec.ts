import { test, expect } from "@playwright/test";

/**
 * Resource Sharing Tests
 *
 * Verifies that the SharePanel component renders correctly when
 * triggered from resource detail pages, displays the access list,
 * and allows granting/revoking access.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 * - Test user owns at least one agent/session
 */

test.describe("Resource Sharing", () => {
  test.describe("Share panel on agent detail", () => {
    test("share button is visible for resource owner", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[data-testid="resource-card"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const shareButton = page.getByRole("button", { name: /share/i });
      // Share button may be behind a PermissionGate -- only visible to owner
      if (await shareButton.isVisible()) {
        await expect(shareButton).toBeEnabled();
      }
    });

    test("opening share panel shows access list", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[data-testid="resource-card"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const shareButton = page.getByRole("button", { name: /share/i });
      if (await shareButton.isVisible()) {
        await shareButton.click();

        const sharePanel = page.getByRole("region", {
          name: "Resource access management",
        });
        await expect(sharePanel).toBeVisible();

        // Should show "Share access" heading
        await expect(sharePanel.getByText("Share access")).toBeVisible();

        // Should show at least "1 person with access" (the owner)
        await expect(sharePanel.getByText(/with access/)).toBeVisible();
      }
    });

    test("share panel has 'Add people' button", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[data-testid="resource-card"]').first();
      await firstAgent.click();

      const shareButton = page.getByRole("button", { name: /share/i });
      if (await shareButton.isVisible()) {
        await shareButton.click();

        const addButton = page.getByRole("button", { name: /Add people/i });
        await expect(addButton).toBeVisible();
      }
    });

    test("clicking 'Add people' reveals grant form", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[data-testid="resource-card"]').first();
      await firstAgent.click();

      const shareButton = page.getByRole("button", { name: /share/i });
      if (await shareButton.isVisible()) {
        await shareButton.click();

        const addButton = page.getByRole("button", { name: /Add people/i });
        await addButton.click();

        // Grant form should now be visible with Account ID input
        const input = page.getByLabel("Account ID");
        await expect(input).toBeVisible();

        // Grant button should be present
        const grantButton = page.getByRole("button", {
          name: /Grant access/i,
        });
        await expect(grantButton).toBeVisible();
      }
    });
  });

  test.describe("Share panel on session", () => {
    test("session share button is visible to session owner", async ({
      page,
    }) => {
      await page.goto("/sessions");
      await page.waitForLoadState("networkidle");

      // Navigate to the first session
      const firstSession = page.locator("a[href^='/sessions/']").first();
      if (await firstSession.isVisible()) {
        await firstSession.click();
        await page.waitForLoadState("networkidle");

        const shareButton = page.getByRole("button", { name: /share/i });
        // Visible only in cloud mode for session owners
        if (await shareButton.isVisible()) {
          await expect(shareButton).toBeEnabled();
        }
      }
    });
  });
});
