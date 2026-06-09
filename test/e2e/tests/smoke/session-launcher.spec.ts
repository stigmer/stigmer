import { test, expect } from "@playwright/test";
import { isAuthGate } from "../../helpers/auth-gate";

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

  test("no error when submitting immediately after page load", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Production redirects the unauthenticated home page to Auth0, where there
    // is no session composer. The composer flow only exists once authenticated.
    if (await isAuthGate(page)) return;

    const textarea = page.locator('textarea, [role="textbox"], [contenteditable="true"]');
    await expect(textarea.first()).toBeVisible({ timeout: 10_000 });

    await textarea.first().fill("Hello, world!");
    await textarea.first().press("Enter");

    await page.waitForTimeout(3000);

    const loadingError = page.locator('text="Loading default agent"');
    const failedError = page.locator('text="Failed to load default agent"');
    const timeoutError = page.locator('text="did not load in time"');

    await expect(loadingError).toHaveCount(0);
    await expect(failedError).toHaveCount(0);
    await expect(timeoutError).toHaveCount(0);
  });
});
