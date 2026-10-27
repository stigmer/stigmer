import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { AXE_TAGS, describeViolations, judgeAxe } from "@stigmer/test-support/axe-policy";

/**
 * Accessibility tests.
 *
 * Runs axe-core WCAG 2.0 AA audits on key pages and verifies keyboard
 * navigation on critical interactive surfaces.
 *
 * The policy is test/support's `axe-policy`, the one the kit's gallery
 * (test/visual) audits with: critical and serious violations fail, contrast
 * included; moderate and minor ones pass.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 */

async function runAxeAudit(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  const { failing } = judgeAxe(results.violations);
  expect(failing, `axe violations:\n${describeViolations(failing)}`).toHaveLength(0);
}

test.describe("Accessibility audits", () => {
  test("home page passes axe-core audit", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    await runAxeAudit(page);
  });

  test("dashboard passes axe-core audit", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByLabel("Platform dashboard")).toBeVisible({
      timeout: 15_000,
    });

    await runAxeAudit(page);
  });

  test("library agents page passes axe-core audit", async ({ page }) => {
    await page.goto("/library/agents");

    await expect(page.getByLabel("Agent workbench")).toBeVisible({
      timeout: 15_000,
    });

    await runAxeAudit(page);
  });

  test("settings page passes axe-core audit", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByLabel("Management navigation")).toBeVisible({
      timeout: 15_000,
    });

    await runAxeAudit(page);
  });
});

test.describe("Keyboard navigation", () => {
  test("sidebar is keyboard-accessible", async ({ page }) => {
    await page.goto("/");

    const sidebar = page.getByLabel("Main navigation");
    await expect(sidebar).toBeVisible({ timeout: 15_000 });

    const dashboardLink = sidebar.getByRole("link", { name: "Dashboard" });
    await expect(dashboardLink).toBeVisible();

    await dashboardLink.focus();
    await expect(dashboardLink).toBeFocused();
  });

  test("session composer textarea is focusable and supports keyboard input", async ({
    page,
  }) => {
    await page.goto("/");

    const composerForm = page.getByRole("form", { name: "Start a new session" });
    await expect(composerForm).toBeVisible({ timeout: 15_000 });

    const textarea = composerForm.getByRole("textbox", {
      name: "Describe what you need help with…",
    });
    await expect(textarea).toBeVisible();

    await textarea.focus();
    await expect(textarea).toBeFocused();

    await textarea.fill("test line one");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("test line two");

    const value = await textarea.inputValue();
    expect(value).toContain("\n");
  });
});

test.describe("Landmark verification", () => {
  test("page has required landmarks", async ({ page }) => {
    await page.goto("/");

    await expect(page.locator("h1").first()).toBeVisible({ timeout: 15_000 });

    const mainElements = page.locator("main");
    await expect(mainElements.first()).toBeVisible();

    const navElements = page.locator("nav");
    const navCount = await navElements.count();
    expect(navCount).toBeGreaterThanOrEqual(1);

    await expect(page.getByLabel("Main navigation")).toBeVisible();
  });
});
