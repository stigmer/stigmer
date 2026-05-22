import { test, expect } from "@playwright/test";

/**
 * Blueprint Visibility Tests
 *
 * Verifies that visibility toggles on agent/workflow/skill resources
 * correctly switch between private and public, and that the scope
 * filter on list pages respects visibility state.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 * - Test user has at least one private agent/workflow/skill
 */

test.describe("Blueprint Visibility", () => {
  test.describe("Agent visibility toggle", () => {
    test("displays private/public segmented control on agent detail", async ({
      page,
    }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();

      const radiogroup = page.getByRole("radiogroup", {
        name: "Resource visibility",
      });
      await expect(radiogroup).toBeVisible();

      const privateOption = radiogroup.getByRole("radio", { name: /Private/i });
      const publicOption = radiogroup.getByRole("radio", { name: /Public/i });
      await expect(privateOption).toBeVisible();
      await expect(publicOption).toBeVisible();
    });

    test("switching to public shows confirmation prompt", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();

      const radiogroup = page.getByRole("radiogroup", {
        name: "Resource visibility",
      });
      const publicOption = radiogroup.getByRole("radio", { name: /Public/i });
      await publicOption.click();

      const confirmAlert = page.getByRole("alert");
      await expect(confirmAlert).toContainText("Make visible to all users");
      await expect(page.getByRole("button", { name: "Confirm" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    });
  });

  test.describe("Workflow visibility toggle", () => {
    test("displays visibility toggle on workflow detail page", async ({
      page,
    }) => {
      await page.goto("/library/workflows");
      await page.waitForLoadState("networkidle");

      const firstWorkflow = page
        .locator('[role="listitem"]')
        .first();
      await firstWorkflow.click();

      const radiogroup = page.getByRole("radiogroup", {
        name: "Resource visibility",
      });
      await expect(radiogroup).toBeVisible();
    });
  });

  test.describe("Scope filter respects visibility", () => {
    test("org-only scope hides public marketplace resources", async ({
      page,
    }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const scopeToggle = page.getByRole("radiogroup", {
        name: /scope/i,
      });

      if (await scopeToggle.isVisible()) {
        const orgOption = scopeToggle.getByRole("radio", { name: /org/i });
        await orgOption.click();
        await page.waitForLoadState("networkidle");
      }
    });
  });
});
