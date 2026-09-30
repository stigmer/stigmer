import { test, expect } from "@playwright/test";

/**
 * Responsive layout tests.
 *
 * Verifies sidebar behavior at mobile (< 1024px) and desktop (>= 1024px)
 * viewports. The sidebar uses width-based collapse (w-60 / w-0 with
 * overflow-hidden), not translate-x or hidden. At mobile viewports it
 * becomes a fixed overlay with a backdrop.
 *
 * Breakpoint: 1024px (Tailwind lg / LG_BREAKPOINT in AppShell)
 * Toggle buttons: "Open sidebar" (fixed, visible when closed)
 *                 "Collapse sidebar" (inside nav, visible when open)
 * localStorage key: "stigmer:sidebar-open"
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 */

test.describe("Responsive: mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("closed sidebar shows open button", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("stigmer:sidebar-open", "false");
    });

    await page.goto("/");

    await expect(page.getByLabel("Open sidebar")).toBeVisible({
      timeout: 15_000,
    });
  });

  test("opening sidebar makes navigation visible", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("stigmer:sidebar-open", "false");
    });

    await page.goto("/");

    const openButton = page.getByLabel("Open sidebar");
    await expect(openButton).toBeVisible({ timeout: 15_000 });

    await openButton.click();

    await expect(page.getByLabel("Main navigation")).toBeVisible();
    await expect(page.getByLabel("Collapse sidebar")).toBeVisible();
  });

  test("the open sidebar lays a backdrop over the page, and clicking it closes the sidebar", async ({
    page,
  }) => {
    // On a narrow viewport the shell closes the sidebar on every route
    // change, the first render included, so it is opened the way a user
    // opens it.
    await page.goto("/");
    await page.getByLabel("Open sidebar").click({ timeout: 15_000 });
    await expect(page.getByLabel("Main navigation")).toBeVisible();

    // The mobile backdrop is a decorative, aria-hidden overlay (AppShell);
    // it has no role or name, so it is found by its marker and position.
    const backdrop = page.locator('div.fixed.inset-0[aria-hidden="true"]');
    await expect(backdrop).toBeVisible();

    // Click the part of the backdrop the sidebar (240px wide) does not cover.
    await backdrop.click({ position: { x: 320, y: 400 } });

    await expect(page.getByLabel("Open sidebar")).toBeVisible();
    await expect(backdrop).toHaveCount(0);
  });
});

test.describe("Responsive: desktop viewport", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("sidebar is in-flow with no backdrop", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("stigmer:sidebar-open", "true");
    });

    await page.goto("/");

    await expect(page.getByLabel("Main navigation")).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByLabel("Collapse sidebar")).toBeVisible();

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
    // The backdrop is the narrow viewport's alone (`lg:hidden`).
    await expect(page.locator('div.fixed.inset-0[aria-hidden="true"]')).toBeHidden();
  });

  test("collapse and reopen cycle works", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("stigmer:sidebar-open", "true");
    });

    await page.goto("/");

    const collapseButton = page.getByLabel("Collapse sidebar");
    await expect(collapseButton).toBeVisible({ timeout: 15_000 });

    await collapseButton.click();

    const openButton = page.getByLabel("Open sidebar");
    await expect(openButton).toBeVisible();

    await openButton.click();

    await expect(page.getByLabel("Main navigation")).toBeVisible();
    await expect(page.getByLabel("Collapse sidebar")).toBeVisible();
  });
});
