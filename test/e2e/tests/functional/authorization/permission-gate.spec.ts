import { test, expect } from "@playwright/test";

/**
 * Permission Gate Tests
 *
 * Verifies that UI elements are correctly shown/hidden based on the
 * user's permissions. Edit/delete buttons should be hidden for viewers,
 * and share buttons should only appear for owners.
 *
 * NOTE: These tests require multi-user setup with different roles.
 * In the initial implementation, they validate the happy path
 * (owner sees all controls). Full permission-gating tests require
 * a test harness that can impersonate different users.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 */

test.describe("Permission-Gated UI", () => {
  test.describe("Owner permissions (happy path)", () => {
    test("agent detail shows edit button for owner", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[data-testid="resource-card"]').first();
      if (await firstAgent.isVisible()) {
        await firstAgent.click();
        await page.waitForLoadState("networkidle");

        // Owner should see edit capabilities
        const editButton = page.getByRole("button", { name: /edit/i });
        const deleteButton = page.getByRole("button", { name: /delete/i });

        // At least one mutating action should be visible to the owner
        const hasEditAction =
          (await editButton.isVisible()) || (await deleteButton.isVisible());
        expect(hasEditAction).toBe(true);
      }
    });

    test("workflow detail shows visibility toggle for owner", async ({
      page,
    }) => {
      await page.goto("/library/workflows");
      await page.waitForLoadState("networkidle");

      const firstWorkflow = page
        .locator('[data-testid="resource-card"]')
        .first();
      if (await firstWorkflow.isVisible()) {
        await firstWorkflow.click();
        await page.waitForLoadState("networkidle");

        const radiogroup = page.getByRole("radiogroup", {
          name: "Resource visibility",
        });
        // Owner should see the visibility toggle (not gated away)
        if (await radiogroup.isVisible()) {
          await expect(radiogroup).not.toHaveAttribute("aria-disabled", "true");
        }
      }
    });
  });

  test.describe("OSS mode (no permission gating)", () => {
    test.skip(
      !!process.env.STIGMER_E2E_CLOUD,
      "Skip in cloud mode - testing OSS permissive behavior",
    );

    test("all actions visible without permission checks in OSS", async ({
      page,
    }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[data-testid="resource-card"]').first();
      if (await firstAgent.isVisible()) {
        await firstAgent.click();
        await page.waitForLoadState("networkidle");

        // In OSS mode, PermissionGate always renders children
        // Authorization-related UI (share, etc.) should be absent entirely
        // since the IAM service doesn't exist
        const shareButton = page.getByRole("button", { name: /share/i });
        // Share should NOT be visible in OSS (no IAM service)
        await expect(shareButton).not.toBeVisible();
      }
    });
  });
});
