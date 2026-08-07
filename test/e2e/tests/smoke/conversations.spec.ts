import { test, expect } from "@playwright/test";
import { isAuthGate } from "../../helpers/auth-gate";

test.describe("Conversations page", () => {
  test("/conversations loads without errors", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto("/conversations");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should not show a full-page error state
    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);
  });

  test("/conversations renders the workbench", async ({ page }) => {
    await page.goto("/conversations");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const errorBoundary = page.locator('text="Something went wrong"');
    await expect(errorBoundary).toHaveCount(0);

    // Production gates this route behind Auth0; a redirect to login is healthy,
    // not a regression. Only assert the workbench when the app rendered.
    if (await isAuthGate(page)) return;

    const workbench = page.locator('[aria-label="Conversations workbench"]');
    await expect(workbench).toBeVisible({ timeout: 10_000 });

    // The inbox pane renders alongside — a list, an empty state, or an
    // error surface, but never a blank pane.
    const listPane = page.locator('[aria-label="Conversation list"]');
    await expect(listPane).toBeVisible();
  });
});
