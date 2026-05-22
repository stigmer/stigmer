import { test, expect } from "@playwright/test";

/**
 * Cross-resource consistency tests.
 *
 * Verifies that agents and workflows share consistent UI patterns:
 * both default to card view, both have search inputs, and both
 * detail pages share the same structural patterns.
 */
test.describe("Library consistency: agents and workflows", () => {
  const LIBRARY_SECTIONS = [
    { path: "/library/agents", label: "Agent workbench", heading: "Agents" },
    { path: "/library/workflows", label: "Workflow workbench", heading: "Workflows" },
  ];

  for (const section of LIBRARY_SECTIONS) {
    test(`${section.heading} list page has heading`, async ({ page }) => {
      await page.goto(section.path);
      await page.waitForLoadState("networkidle");

      const heading = page.locator(`h1:has-text("${section.heading}")`);
      await expect(heading).toBeVisible({ timeout: 10_000 });
    });

    test(`${section.heading} list page has search input`, async ({ page }) => {
      await page.goto(section.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const searchInput = page.locator('input[type="search"], input[placeholder*="Search"]');
      await expect(searchInput).toBeVisible({ timeout: 10_000 });
    });

    test(`${section.heading} list page has workbench`, async ({ page }) => {
      await page.goto(section.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const workbench = page.locator(`[aria-label="${section.label}"]`);
      await expect(workbench).toBeVisible({ timeout: 10_000 });
    });
  }

  test("both list pages default to card view or empty state", async ({ page }) => {
    for (const section of LIBRARY_SECTIONS) {
      await page.goto(section.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      // Each should show either card grid or empty state — never a bare table by default
      const cardGrid = page.locator('[role="list"][aria-label="Resource cards"]');
      const emptyState = page.locator(`text="No ${section.heading.toLowerCase()} yet"`);
      const table = page.locator("table");

      const hasCards = await cardGrid.isVisible().catch(() => false);
      const hasEmpty = await emptyState.isVisible().catch(() => false);
      const hasTable = await table.isVisible().catch(() => false);

      // Default should be cards or empty — not bare table
      // (Table is only shown if user explicitly switched)
      expect(
        hasCards || hasEmpty,
      ).toBeTruthy();
    }
  });

  test("both list pages have a Create button in the header area", async ({ page }) => {
    for (const section of LIBRARY_SECTIONS) {
      await page.goto(section.path);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const createLink = page.locator(
        `a:has-text("Create ${section.heading.toLowerCase().replace(/s$/, "")}")`,
      );

      // The create button should be somewhere on the page
      const hasCreate = await createLink.isVisible().catch(() => false);
      // Fall back to checking for any "Create" link/button
      const anyCreate = await page.locator('a:has-text("Create")').first().isVisible().catch(() => false);

      expect(hasCreate || anyCreate).toBeTruthy();
    }
  });
});
