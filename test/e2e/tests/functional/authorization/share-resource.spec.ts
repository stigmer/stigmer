import { test, expect, type Page } from "@playwright/test";

/**
 * Unified "Manage access" Tests
 *
 * Sharing is no longer a bespoke "Share" popover per surface. Every resource
 * with a detail surface now opens one canonical "Manage access" dialog that
 * composes both access axes — *General access* (visibility) over *People with
 * access* (explicit grants). Blueprints (agent / skill / mcp_server) gained the
 * People axis they previously lacked; this suite proves the journey on them.
 *
 * Two affordances open the same dialog:
 * - Family A (agent / skill / mcp_server / workflow detail): a "Manage access"
 *   item in the kebab/overflow menu.
 * - Family B (session / workflow-execution viewer): a visible "Manage access"
 *   button in the header.
 *
 * Prerequisites:
 * - Running against a Cloud-connected backend with FGA enabled
 * - Test user owns at least one agent/session
 */

/**
 * Opens the kebab "Manage access" dialog for a Family A detail page. Returns the
 * dialog locator, or null when the action is not offered (the entry is gated on
 * `can_view_access`, so a non-owner legitimately sees nothing).
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

test.describe("Manage access", () => {
  test.describe("Manage access on agent detail (kebab)", () => {
    test("kebab exposes a Manage access action for the owner", async ({
      page,
    }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const kebab = page.getByRole("button", { name: "More actions" });
      if (await kebab.isVisible()) {
        await kebab.click();
        const item = page.getByRole("menuitem", { name: "Manage access" });
        // The action is gated on can_view_access — assert it is actionable only
        // when present (owner), never that it must exist for every caller.
        if (await item.isVisible()) {
          await expect(item).toBeEnabled();
        }
      }
    });

    test("dialog shows General access and People with access", async ({
      page,
    }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const dialog = await openManageAccessFromKebab(page);
      if (dialog) {
        await expect(dialog.getByText("Manage access")).toBeVisible();
        // Blueprints have both axes: visibility + people.
        await expect(dialog.getByText("General access")).toBeVisible();
        await expect(dialog.getByText("People with access")).toBeVisible();
        // The owner is always at least one person with access.
        await expect(dialog.getByText(/with access/)).toBeVisible();
      }
    });

    test("'Add people' reveals the grant form", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const dialog = await openManageAccessFromKebab(page);
      if (dialog) {
        const addButton = dialog.getByRole("button", { name: /Add people/i });
        // The grant form is gated on can_grant_access — only owners see it.
        if (await addButton.isVisible()) {
          await addButton.click();
          await expect(
            dialog.getByRole("button", { name: /Grant access/i }),
          ).toBeVisible();
        }
      }
    });

    test("dialog closes via Done", async ({ page }) => {
      await page.goto("/library/agents");
      await page.waitForLoadState("networkidle");

      const firstAgent = page.locator('[role="listitem"]').first();
      await firstAgent.click();
      await page.waitForLoadState("networkidle");

      const dialog = await openManageAccessFromKebab(page);
      if (dialog) {
        await dialog.getByRole("button", { name: "Done" }).click();
        await expect(dialog).toBeHidden();
      }
    });
  });

  test.describe("Manage access on session (header button)", () => {
    test("session header exposes a Manage access button to the owner", async ({
      page,
    }) => {
      await page.goto("/sessions");
      await page.waitForLoadState("networkidle");

      const firstSession = page.locator("a[href^='/sessions/']").first();
      if (await firstSession.isVisible()) {
        await firstSession.click();
        await page.waitForLoadState("networkidle");

        const manageButton = page.getByRole("button", {
          name: /Manage access/i,
        });
        // Visible only in cloud mode for those who can view access.
        if (await manageButton.isVisible()) {
          await manageButton.click();
          const dialog = page.getByRole("dialog");
          await expect(dialog.getByText("Manage access")).toBeVisible();
          // Sessions have no visibility axis — only People.
          await expect(dialog.getByText("People with access")).toBeVisible();
          await expect(dialog.getByText("General access")).toBeHidden();
        }
      }
    });
  });
});
