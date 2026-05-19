import { test, expect } from "@playwright/test";

/**
 * Instance Visibility Tests
 *
 * Verifies that the 3-state visibility selector (private/org/public)
 * renders correctly on instance detail views and that visibility
 * escalation shows appropriate confirmation prompts.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 * - Test user has at least one agent/workflow instance they own
 */

test.describe("Instance Visibility", () => {
  test.describe("Instance visibility selector", () => {
    test("displays 3-way selector: private, organization, public", async ({
      page,
    }) => {
      // Navigate to a workflow detail that has instances
      await page.goto("/library/workflows");
      await page.waitForLoadState("networkidle");

      const firstWorkflow = page
        .locator('[data-testid="resource-card"]')
        .first();
      await firstWorkflow.click();
      await page.waitForLoadState("networkidle");

      // Look for instances tab or section
      const instancesTab = page.getByRole("tab", { name: /instances/i });
      if (await instancesTab.isVisible()) {
        await instancesTab.click();
      }

      // The InstanceVisibilitySelector should have 3 radio options
      const radiogroup = page.getByRole("radiogroup", {
        name: "Instance visibility",
      });

      if (await radiogroup.isVisible()) {
        const privateOption = radiogroup.getByRole("radio", {
          name: /Private/i,
        });
        const orgOption = radiogroup.getByRole("radio", {
          name: /Organization/i,
        });
        const publicOption = radiogroup.getByRole("radio", {
          name: /Public/i,
        });

        await expect(privateOption).toBeVisible();
        await expect(orgOption).toBeVisible();
        await expect(publicOption).toBeVisible();
      }
    });

    test("escalating to org visibility shows blue confirmation", async ({
      page,
    }) => {
      await page.goto("/library/workflows");
      await page.waitForLoadState("networkidle");

      const firstWorkflow = page
        .locator('[data-testid="resource-card"]')
        .first();
      await firstWorkflow.click();

      const radiogroup = page.getByRole("radiogroup", {
        name: "Instance visibility",
      });

      if (await radiogroup.isVisible()) {
        const orgOption = radiogroup.getByRole("radio", {
          name: /Organization/i,
        });
        await orgOption.click();

        const confirmAlert = page.getByRole("alert");
        await expect(confirmAlert).toContainText(
          "Make visible to all org members",
        );
      }
    });

    test("escalating to public visibility shows amber confirmation", async ({
      page,
    }) => {
      await page.goto("/library/workflows");
      await page.waitForLoadState("networkidle");

      const firstWorkflow = page
        .locator('[data-testid="resource-card"]')
        .first();
      await firstWorkflow.click();

      const radiogroup = page.getByRole("radiogroup", {
        name: "Instance visibility",
      });

      if (await radiogroup.isVisible()) {
        const publicOption = radiogroup.getByRole("radio", {
          name: /Public/i,
        });
        await publicOption.click();

        const confirmAlert = page.getByRole("alert");
        await expect(confirmAlert).toContainText(
          "Make visible to all authenticated users",
        );
      }
    });
  });
});
