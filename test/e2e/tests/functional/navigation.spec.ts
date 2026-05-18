import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("non-existent route returns 404 page or redirects", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await page.waitForLoadState("networkidle");

    const is404 = await page.locator('text="Page not found"').count();
    const isHome = page.url().endsWith("/");
    expect(is404 > 0 || isHome).toBeTruthy();
  });
});
