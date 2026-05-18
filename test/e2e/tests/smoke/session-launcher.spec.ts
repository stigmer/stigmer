import { test, expect } from "@playwright/test";

test.describe("Session launcher", () => {
  test("renders the session composer on the home page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10_000 });

    const text = await heading.textContent();
    expect(text).toBeTruthy();
  });

  test("no 'Failed to load default agent' error on page load", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(5000);

    const errorText = page.locator('text="Failed to load default agent"');
    await expect(errorText).toHaveCount(0);
  });
});
