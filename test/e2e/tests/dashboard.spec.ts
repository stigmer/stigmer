import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("loads without errors", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Dashboard heading should be visible
    const heading = page.locator('h1:has-text("Dashboard")');
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test("renders operational overview section", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Look for the overview description text
    const description = page.locator('text="Operational overview"');
    await expect(description).toBeVisible({ timeout: 15_000 });
  });
});
