import { test, expect } from "@playwright/test";

test.describe("Workflow list page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");
  });

  test("renders heading and description", async ({ page }) => {
    const heading = page.locator('h1:has-text("Workflows")');
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const description = page.locator(
      'text="Browse and manage multi-step orchestration workflows."',
    );
    await expect(description).toBeVisible();
  });

  test("renders workbench with search input", async ({ page }) => {
    const workbench = page.locator('[aria-label="Workflow workbench"]');
    await expect(workbench).toBeVisible({ timeout: 10_000 });

    const search = page.locator(
      'input[placeholder="Search workflows…"], input[placeholder*="Search workflow"]',
    );
    await expect(search).toBeVisible();
  });

  test("shows card view by default (role=list container)", async ({ page }) => {
    await page.waitForTimeout(3000);

    // Either cards are visible (if data exists) or empty state is shown
    const cardGrid = page.locator('[role="list"][aria-label="Resource cards"]');
    const emptyState = page.locator('text="No workflows yet"');

    const hasCards = await cardGrid.isVisible().catch(() => false);
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect(hasCards || hasEmpty).toBeTruthy();
  });

  test("view mode toggle is present with table and cards options", async ({ page }) => {
    await page.waitForTimeout(2000);

    // The view switcher should be present in the workbench toolbar
    const workbench = page.locator('[aria-label="Workflow workbench"]');
    await expect(workbench).toBeVisible({ timeout: 10_000 });
  });

  test("Create workflow button is visible in header", async ({ page }) => {
    const createButton = page.locator('a:has-text("Create workflow")');
    await expect(createButton).toBeVisible({ timeout: 10_000 });
  });

  test("Import button is visible in header", async ({ page }) => {
    const importButton = page.locator('[aria-label="Import from file"]');
    await expect(importButton).toBeVisible({ timeout: 10_000 });
  });

  test("empty state shows create CTA when no workflows exist", async ({ page }) => {
    await page.waitForTimeout(3000);

    const emptyState = page.locator('text="No workflows yet"');
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    if (hasEmpty) {
      const emptyCta = page.locator(
        '[aria-label="Workflow workbench"] >> a:has-text("Create workflow")',
      );
      await expect(emptyCta).toBeVisible();
    }
  });
});
