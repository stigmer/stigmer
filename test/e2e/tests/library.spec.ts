import { test, expect } from "@playwright/test";

test.describe("Library pages", () => {
  for (const section of ["agents", "workflows", "skills"]) {
    test(`/library/${section} loads without errors`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      });

      await page.goto(`/library/${section}`);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(3000);

      // Should not show a full-page error state
      const errorBoundary = page.locator('text="Something went wrong"');
      await expect(errorBoundary).toHaveCount(0);
    });
  }
});
