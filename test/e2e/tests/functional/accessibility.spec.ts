import AxeBuilder from "@axe-core/playwright";
import { AXE_TAGS, describeViolations, judgeAxe } from "@stigmer/test-support/axe-policy";
import { test, expect } from "../../fixtures";
import { createTestAgent } from "../../fixtures/seed-helpers";

/**
 * Accessibility tests.
 *
 * Runs axe-core WCAG 2.0 AA audits on key pages (the launcher, the
 * dashboard, the Library, an agent's page, the marketplace, and every
 * settings page the open-source owner's settings navigation links) and
 * verifies keyboard navigation on critical interactive surfaces.
 *
 * The policy is test/support's `axe-policy`, the one the kit's gallery
 * (test/visual) audits with: critical and serious violations fail, contrast
 * included; moderate and minor ones pass.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 */

async function runAxeAudit(page: import("@playwright/test").Page) {
  expect(await axeFailures(page), "axe violations").toBe("");
}

/**
 * Resolves once the page has settled after a move within the app: no region
 * still marked busy, and no request in flight for QUIET_MS. A client-side
 * move has no load event to wait for, and an audit taken while a page's own
 * reads are out judges whatever has drawn so far.
 */
async function settled(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
  let inFlight = 0;
  let quietSince = Date.now();
  const begin = () => {
    inFlight += 1;
  };
  const end = () => {
    inFlight -= 1;
    if (inFlight <= 0) quietSince = Date.now();
  };
  page.on("request", begin);
  page.on("requestfinished", end);
  page.on("requestfailed", end);
  try {
    await expect
      .poll(() => inFlight <= 0 && Date.now() - quietSince >= QUIET_MS, { timeout: 15_000, intervals: [100] })
      .toBe(true);
  } finally {
    page.off("request", begin);
    page.off("requestfinished", end);
    page.off("requestfailed", end);
  }
}

/** How long a page goes with no request in flight before it counts as settled. */
const QUIET_MS = 500;

/** The page's critical and serious violations, described; empty when it passes. */
async function axeFailures(page: import("@playwright/test").Page): Promise<string> {
  const results = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  const { failing } = judgeAxe(results.violations);
  return failing.length === 0 ? "" : describeViolations(failing);
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

  test("an agent's page passes axe-core audit", async ({ page, stigmerClient }) => {
    const agent = await createTestAgent(stigmerClient);
    try {
      await page.goto(`/library/agents/${agent.org}/${agent.slug}`);
      await expect(page.getByRole("button", { name: "Start session" })).toBeVisible({ timeout: 15_000 });
      await page.waitForLoadState("networkidle");

      await runAxeAudit(page);
    } finally {
      await agent.cleanup();
    }
  });

  test("marketplace passes axe-core audit", async ({ page }) => {
    await page.goto("/marketplace");

    await expect(page.getByLabel("Search plugins")).toBeVisible({ timeout: 15_000 });
    // The grid (its Upload tile first, for an admin) once the sources are
    // read; the catalogue's reads keep the network busy, so idle is no signal.
    await expect(page.getByRole("list", { name: "Plugins" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("status").filter({ hasText: /^Reading / })).toHaveCount(0);

    await runAxeAudit(page);
  });

  // The pages are the ones the settings navigation links for this person on
  // this edition, read from the navigation itself, so a page added to it is
  // audited without anyone listing it here. Each is opened from its link, as
  // a person moves between them (a full load per page raced the dev server's
  // compile of the next route). Every page is audited before the case
  // judges, so one page's violations never hide another's.
  test("every settings page the navigation links passes axe-core audit", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.getByLabel("Management navigation");
    await expect(nav).toBeVisible({ timeout: 15_000 });
    const hrefs = await nav
      .getByRole("link")
      .evaluateAll((links) => [...new Set(links.map((link) => link.getAttribute("href") ?? ""))]);
    const settingsPages = hrefs.filter((href) => href.startsWith("/settings/"));
    expect(settingsPages.length, "the settings navigation links no settings page").toBeGreaterThan(0);

    const failures: string[] = [];
    for (const href of settingsPages) {
      await nav.locator(`a[href="${href}"]`).first().click();
      await page.waitForURL(`**${href}`);
      await expect(page.getByRole("region").first(), `${href} shows no section`).toBeVisible({ timeout: 15_000 });
      await settled(page);
      const report = await axeFailures(page);
      if (report !== "") failures.push(`${href}\n${report}`);
    }
    expect(failures, `settings pages with violations:\n${failures.join("\n\n")}`).toEqual([]);
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
