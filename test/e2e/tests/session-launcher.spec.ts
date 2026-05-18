import { test, expect } from "@playwright/test";

test.describe("Session launcher", () => {
  test("renders the session composer on the home page", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // The SessionLauncher should render a heading
    const heading = page.locator("h1");
    await expect(heading).toBeVisible({ timeout: 10_000 });

    // The heading should contain either the session prompt or a loading state
    const text = await heading.textContent();
    expect(text).toBeTruthy();
  });

  test("session composer has a text input area", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for textarea or contenteditable area used for prompt input
    const textarea = page.locator('textarea, [role="textbox"], [contenteditable="true"]');
    await expect(textarea.first()).toBeVisible({ timeout: 10_000 });
  });

  test("no 'Failed to load default agent' error on page load", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(5000);

    const errorText = page.locator('text="Failed to load default agent"');
    await expect(errorText).toHaveCount(0);
  });
});
