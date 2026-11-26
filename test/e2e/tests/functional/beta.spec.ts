import { test, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * Stigmer says it is in Beta in the console of every edition. On the
 * trusted-local stack (a laptop's `stigmer up`, where no one signs in), the
 * sidebar's top row carries the "Beta" mark, linking the page that says what
 * Beta means in a new tab, its accessible name the whole line: at a desk's
 * width with the sidebar open, and at a phone's once the menu is opened. The
 * OIDC stack's sign-in page says the line before anyone signs in
 * (tests/console-login/sign-in-says-beta.spec.ts).
 */

const BETA_LINE = "Stigmer is in Beta: things may change, and your work is kept. Tell us what breaks.";
const BETA_URL = "https://stigmer.ai/docs/beta";

async function expectMark(page: Page, testInfo: TestInfo, width: string): Promise<void> {
  const sidebar = page.getByRole("navigation", { name: "Main navigation" });
  const mark = sidebar.getByRole("link", { name: BETA_LINE, exact: true });
  await expect(mark).toBeVisible({ timeout: 15_000 });
  await expect(mark).toHaveText("Beta");
  await expect(mark).toHaveAttribute("href", BETA_URL);
  await expect(mark).toHaveAttribute("target", "_blank");
  await testInfo.attach(`sidebar-beta-${width}`, { body: await page.screenshot(), contentType: "image/png" });
}

test.describe("Stigmer says it is in Beta in the console", () => {
  test("the sidebar's top row carries the Beta mark at a desk's width", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expectMark(page, testInfo, "1440");
  });

  test("the sidebar's top row carries the Beta mark on a phone, once the menu is opened", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open sidebar" }).click({ timeout: 15_000 });
    await expectMark(page, testInfo, "390");
  });
});
