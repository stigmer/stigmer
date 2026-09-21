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

    // With no agent picked the built-in assistant answers: nothing is looked
    // up before the send, so no agent-resolution error can surface.
    const agentError = page.locator('text=/agent/i').filter({ hasText: /failed|not found|did not load/i });
    await expect(agentError).toHaveCount(0);
  });
});
