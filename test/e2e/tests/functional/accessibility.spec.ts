import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility tests.
 *
 * Runs axe-core WCAG 2.0 AA audits on key pages and verifies keyboard
 * navigation on critical interactive surfaces.
 *
 * Initial rollout: fails on critical and serious violations only.
 * Moderate and minor violations are logged but do not fail.
 *
 * Known exclusions:
 * - SessionComposer textarea lacks aria-label (only placeholder);
 *   tracked as a backlog fix in the SDK.
 * - Workflow canvas (React Flow) has complex a11y characteristics
 *   that are not meaningful to audit structurally.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 */

async function runAxeAudit(page: import("@playwright/test").Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .exclude('[role="form"][aria-label="Send message"] textarea')
    .analyze();

  const serious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );

  if (serious.length > 0) {
    const summary = serious
      .map(
        (v) =>
          `[${v.impact}] ${v.id}: ${v.description} (${v.nodes.length} node(s))`,
      )
      .join("\n");
    expect(serious, `axe violations:\n${summary}`).toHaveLength(0);
  }
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

    const composerForm = page.locator(
      '[role="form"][aria-label="Send message"]',
    );
    await expect(composerForm).toBeVisible({ timeout: 15_000 });

    const textarea = composerForm.locator("textarea");
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
