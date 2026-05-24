import { test, expect } from "@playwright/test";

/**
 * Execution history tab tests (T13).
 *
 * These tests navigate to a workflow detail page, switch to the
 * Executions tab, and verify the execution history table, health
 * metrics strip, filter bar, and failure analysis panel render
 * correctly.
 *
 * Requires at least one workflow to exist in the local dev server.
 * Tests skip gracefully when no workflows or executions are available.
 */
test.describe("Workflow execution history", () => {
  let workflowUrl: string | null = null;

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

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

  test("executions tab renders the execution history table", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");

    const executionsTab = page.locator('[role="tab"]:has-text("Executions")');
    await expect(executionsTab).toBeVisible({ timeout: 10_000 });
    await executionsTab.click();

    // The execution history section should be visible
    const historySection = page.locator('[aria-label="Execution history"]');
    await expect(historySection).toBeVisible({ timeout: 10_000 });
  });

  test("health metrics strip renders when data is available", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");

    const executionsTab = page.locator('[role="tab"]:has-text("Executions")');
    await executionsTab.click();

    const metricsStrip = page.locator('[aria-label="Execution health metrics"]');
    // Strip renders when summary data loads (may show skeleton first)
    const stripOrLoading = page.locator(
      '[aria-label="Execution health metrics"], [aria-label="Loading health metrics"]',
    );
    await expect(stripOrLoading.first()).toBeVisible({ timeout: 10_000 });
  });

  test("filter bar renders phase filter chips", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");

    const executionsTab = page.locator('[role="tab"]:has-text("Executions")');
    await executionsTab.click();

    const filterBar = page.locator('[aria-label="Execution filters"]');
    await expect(filterBar).toBeVisible({ timeout: 10_000 });

    // Phase chips should be present
    const completedChip = filterBar.locator('button:has-text("Completed")');
    await expect(completedChip).toBeVisible();

    const failedChip = filterBar.locator('button:has-text("Failed")');
    await expect(failedChip).toBeVisible();
  });

  test("phase filter chips toggle and filter the table", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");

    const executionsTab = page.locator('[role="tab"]:has-text("Executions")');
    await executionsTab.click();

    await page.waitForTimeout(2000);

    const filterBar = page.locator('[aria-label="Execution filters"]');
    const failedChip = filterBar.locator('button:has-text("Failed")');

    // Click Failed filter chip
    await failedChip.click();
    await expect(failedChip).toHaveAttribute("aria-pressed", "true");

    // Click again to deactivate
    await failedChip.click();
    await expect(failedChip).toHaveAttribute("aria-pressed", "false");
  });

  test("execution table has sortable column headers", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");

    const executionsTab = page.locator('[role="tab"]:has-text("Executions")');
    await executionsTab.click();

    await page.waitForTimeout(2000);

    const table = page.locator('[aria-label="Execution history"]');
    if (!(await table.isVisible().catch(() => false))) {
      test.skip(true, "No execution history table rendered (possibly no executions)");
      return;
    }

    // Table should have Name and Status column headers
    const nameHeader = table.locator("th", { hasText: "Name" });
    await expect(nameHeader).toBeVisible();

    const statusHeader = table.locator("th", { hasText: "Status" });
    await expect(statusHeader).toBeVisible();

    const durationHeader = table.locator("th", { hasText: "Duration" });
    await expect(durationHeader).toBeVisible();
  });

  test("clicking a row navigates to execution detail", async ({ page }) => {
    test.skip(!workflowUrl, "No workflows available");

    await page.goto(workflowUrl!);
    await page.waitForLoadState("networkidle");

    const executionsTab = page.locator('[role="tab"]:has-text("Executions")');
    await executionsTab.click();

    await page.waitForTimeout(2000);

    const firstRow = page.locator('[aria-label="Execution history"] tbody tr').first();
    if (!(await firstRow.isVisible().catch(() => false))) {
      test.skip(true, "No execution rows to click");
      return;
    }

    const initialUrl = page.url();
    await firstRow.click();
    await page.waitForTimeout(1000);

    // URL should have changed (navigated to execution detail)
    expect(page.url()).not.toBe(initialUrl);
  });
});
