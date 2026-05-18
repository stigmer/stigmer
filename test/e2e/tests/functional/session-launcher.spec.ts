import { test, expect } from "@playwright/test";

test.describe("Session launcher", () => {
  test("session composer has a text input area", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    const textarea = page.locator('textarea, [role="textbox"], [contenteditable="true"]');
    await expect(textarea.first()).toBeVisible({ timeout: 10_000 });
  });
});
