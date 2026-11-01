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

  // The console ships its own typeface and the theme's font stack falls back
  // through the variable the font loader defines; when that variable sits
  // where the stack cannot see it, every page renders in the computer's own
  // font while the files download unused (stigmer#1564). `/login` is the one
  // page every deployment serves from the console signed out (`/` hands a
  // signed-out visit to the identity provider). The family is read from the
  // page, never hard-coded, so the check follows the loader.
  test("the sign-in page renders in the console's own typeface", async ({ page }) => {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    const face = await page.evaluate(async () => {
      await document.fonts.ready;
      const firstFamily = (stack: string) =>
        (stack.split(",")[0] ?? "").trim().replace(/^["']|["']$/g, "");
      const body = getComputedStyle(document.body);
      return {
        own: firstFamily(body.getPropertyValue("--font-geist-sans")),
        rendered: firstFamily(body.fontFamily),
        loaded: [...document.fonts]
          .filter((font) => font.status === "loaded")
          .map((font) => firstFamily(font.family)),
      };
    });

    expect(face.own, "the font loader defines --font-geist-sans").not.toBe("");
    expect(face.rendered).toBe(face.own);
    expect(face.loaded).toContain(face.own);
  });
});
