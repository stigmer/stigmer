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
});
