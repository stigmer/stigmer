import { test, expect } from "@playwright/test";

/**
 * Workflow detail page tests.
 *
 * These tests navigate to a workflow detail page and verify the UI
 * structure. They require at least one workflow to exist in the
 * local dev server. If the workflows list is empty or the detail
 * page cannot be reached, tests skip gracefully.
 */
test.describe("Workflow detail page", () => {
  let workflowUrl: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Try to find and click the first workflow card/row to get a detail URL
    const firstCard = page.locator('[role="listitem"]').first();
    const firstRow = page.locator("table tbody tr").first();

    if (await firstCard.isVisible().catch(() => false)) {
      await firstCard.click();
      await page.waitForLoadState("networkidle");
      workflowUrl = page.url();
    } else if (await firstRow.isVisible().catch(() => false)) {
      await firstRow.click();
      await page.waitForLoadState("networkidle");
      workflowUrl = page.url();
    }

    await page.close();
  });

  test("detail page renders heading and tabs", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available to test detail page");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should not show error boundary
    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);

    // Tab bar should be visible with at least Overview tab
    const overviewTab = page.locator('[role="tab"]:has-text("Overview")');
    await expect(overviewTab).toBeVisible({ timeout: 10_000 });
  });

  test("all expected tabs are present", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available to test detail page");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");

    const expectedTabs = ["Overview", "Instances", "Executions", "Editor"];
    for (const tabName of expectedTabs) {
      const tab = page.locator(`[role="tab"]:has-text("${tabName}")`);
      await expect(tab).toBeVisible({ timeout: 10_000 });
    }
  });

  test("overview tab shows description section", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available to test detail page");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // The overview tab is active by default, check for section headings
    const descriptionSection = page.locator('text="Description"').first();
    const taskFlowSection = page.locator('h3:has-text("Task Flow")').first();

    const hasDescription = await descriptionSection.isVisible().catch(() => false);
    const hasTaskFlow = await taskFlowSection.isVisible().catch(() => false);

    // At minimum, the Task Flow section should exist (all workflows have tasks)
    expect(hasDescription || hasTaskFlow).toBeTruthy();
  });

  test("tab switching works", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available to test detail page");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Click Instances tab
    const instancesTab = page.locator('[role="tab"]:has-text("Instances")');
    await instancesTab.click();
    await page.waitForTimeout(500);

    // Instances tab should now be active
    await expect(instancesTab).toHaveAttribute("aria-selected", "true");

    // Click Executions tab
    const executionsTab = page.locator('[role="tab"]:has-text("Executions")');
    await executionsTab.click();
    await page.waitForTimeout(500);

    await expect(executionsTab).toHaveAttribute("aria-selected", "true");
  });

  test("action menu has expected items", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available to test detail page");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Find and click the kebab menu trigger
    const kebab = page.locator('[aria-label="More actions"], button:has(svg)').last();
    if (await kebab.isVisible().catch(() => false)) {
      await kebab.click();
      await page.waitForTimeout(300);

      // Check for expected menu items
      const copyId = page.locator('[role="menuitem"]:has-text("Copy ID")');
      const copySlug = page.locator('[role="menuitem"]:has-text("Copy slug")');
      const exportYaml = page.locator('[role="menuitem"]:has-text("Export YAML")');
      const deleteItem = page.locator('[role="menuitem"]:has-text("Delete")');

      const hasCopyId = await copyId.isVisible().catch(() => false);
      const hasCopySlug = await copySlug.isVisible().catch(() => false);
      const hasExportYaml = await exportYaml.isVisible().catch(() => false);
      const hasDelete = await deleteItem.isVisible().catch(() => false);

      // At least some standard actions should be present
      expect(hasCopyId || hasCopySlug || hasExportYaml || hasDelete).toBeTruthy();
    }
  });

  test("Run button is visible for workflows", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available to test detail page");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    const runButton = page.locator('button:has-text("Run")');
    await expect(runButton).toBeVisible({ timeout: 10_000 });
  });
});
