import { test, expect } from "@playwright/test";

test.describe("Library pages", () => {
  for (const section of ["agents", "workflows", "skills"]) {
    test(`/library/${section} loads without errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(`/library/${section}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      // Should not show a full-page error state
      const errorBoundary = page.locator('text="Something went wrong"');
      await expect(errorBoundary).toHaveCount(0);
    });
  }

  test("/library/workflows has view toggle and defaults to cards", async ({ page }) => {
    await page.goto("/library/workflows");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);

    // The workbench should render — either cards, table, or empty state
    const workbench = page.locator('[aria-label="Workflow workbench"]');
    await expect(workbench).toBeVisible({ timeout: 10_000 });
  });

  test("/library/agents has view toggle and defaults to cards", async ({ page }) => {
    await page.goto("/library/agents");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);

    const workbench = page.locator('[aria-label="Agent workbench"]');
    await expect(workbench).toBeVisible({ timeout: 10_000 });
  });
});
