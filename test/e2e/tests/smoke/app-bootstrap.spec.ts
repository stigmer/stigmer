import { test, expect } from "@playwright/test";

test.describe("App bootstrap", () => {
  test("loads without critical console errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Filter out expected noise (e.g., third-party script errors, favicon)
    const criticalErrors = consoleErrors.filter(
      (msg) =>
        !msg.includes("favicon") &&
        !msg.includes("third-party") &&
        !msg.includes("[HMR]"),
    );

    expect(criticalErrors).toEqual([]);
  });

  test("does not show 'Failed to load' error banners", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Wait a reasonable time for async loads to settle
    await page.waitForTimeout(3000);

    const failedBanners = page.locator('text="Failed to load"');
    await expect(failedBanners).toHaveCount(0);
  });

  test("page title is set", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title).toBeTruthy();
  });
});
