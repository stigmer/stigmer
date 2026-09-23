import { test, expect, type Page } from "@playwright/test";

/**
 * Blueprint Visibility Tests
 *
 * Visibility editing now lives inside the unified "Manage access" dialog: the
 * detail-page header shows a read-only visibility badge, and the editable
 * segmented control moved into the dialog's *General access* section (one
 * editing surface for "who can get to this?"). These specs drive that dialog.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 * - Test user has at least one private agent/workflow/skill
 */

/**
 * Opens the kebab "Manage access" dialog for a Family A detail page. Returns the
 * dialog locator, or null when the action is not offered (gated on
 * `can_view_access`).
 */
async function openManageAccessFromKebab(page: Page) {
  const kebab = page.getByRole("button", { name: "More actions" });
  if (!(await kebab.isVisible())) return null;
  await kebab.click();

  const item = page.getByRole("menuitem", { name: "Manage access" });
  if (!(await item.isVisible())) return null;
  await item.click();

  return page.getByRole("dialog");
}

test.describe("Blueprint Visibility", () => {
  test.describe("Agent visibility", () => {
    test("header shows a read-only visibility badge", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      // The inline control is now a read-only badge naming the current level.
      await expect(
        page
          .getByText(/^(Private|Organization|Platform)$/)
          .first(),
      ).toBeVisible();
    });

    test("General access control is editable inside the dialog", async ({
      page,
    }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const dialog = await openManageAccessFromKebab(page);
      if (dialog) {
        await expect(dialog.getByText("General access")).toBeVisible();
        // Editable only for can_edit; the control is a popover trigger naming
        // the current level. Assert it when the owner can edit.
        const control = dialog.getByRole("button", {
          name: /Resource visibility/i,
        });
        if (await control.isVisible()) {
          await expect(control).toBeEnabled();
        }
      }
    });

    test("the visibility control never offers Public", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const dialog = await openManageAccessFromKebab(page);
      if (dialog) {
        const control = dialog.getByRole("button", {
          name: /Resource visibility/i,
        });
        if (await control.isVisible()) {
          await control.click();
          // The public level is retired: the ladder is Private / Organization
          // [/ Platform], and no row offers the retired level.
          await expect(page.getByRole("option", { name: /^Private/i })).toBeVisible();
          await expect(page.getByRole("option", { name: /^Public/i })).toHaveCount(0);
        }
      }
    });
  });

  test.describe("Workflow visibility", () => {
    test("workflow detail exposes Manage access with a General access section", async ({
      page,
    }) => {
      await page.goto("/library/workflows");
      await page.waitForLoadState("networkidle");

      const firstWorkflow = page.locator('[role="listitem"]').first();
      await firstWorkflow.click();
      await page.waitForLoadState("networkidle");

      const dialog = await openManageAccessFromKebab(page);
      if (dialog) {
        await expect(dialog.getByText("General access")).toBeVisible();
      }
    });
  });
});
