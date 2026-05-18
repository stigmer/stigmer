import { test, expect } from "@playwright/test";

test.describe("Navigation", () => {
  test("root redirects or shows session launcher", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(500);
  });

  test("/login page renders without crash", async ({ page }) => {
    const response = await page.goto("/login");
    expect(response?.status()).toBeLessThan(500);
  });

  test("non-existent route returns 404 page or redirects", async ({ page }) => {
    await page.goto("/this-route-does-not-exist");
    await page.waitForLoadState("networkidle");

    // Should either show the not-found page or redirect to home
    const is404 = await page.locator('text="Page not found"').count();
    const isHome = page.url().endsWith("/");
    expect(is404 > 0 || isHome).toBeTruthy();
  });
});
