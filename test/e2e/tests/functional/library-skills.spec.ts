import { test, expect } from "@playwright/test";

/**
 * Skills list page structural tests.
 *
 * Verifies that /library/skills renders the correct heading, search,
 * workbench (cards or empty state), scope/view toggles, and the
 * "Upload skill" action link.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 */

test.describe("Skills list page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library/skills");
  });

  test("renders heading and subtitle", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "Skills" }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText("Browse and manage skills in your organization."),
    ).toBeVisible();
  });

  test("has search input with correct label", async ({ page }) => {
    await expect(
      page.getByRole("textbox", { name: "Search skills\u2026" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("has workbench with cards or empty state", async ({ page }) => {
    await expect(page.getByLabel("Skill workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page
        .getByRole("list", { name: "Resource cards" })
        .or(page.getByText("No skills yet")),
    ).toBeVisible();
  });

  test("has Upload skill action", async ({ page }) => {
    await expect(page.getByLabel("Skill workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page.getByRole("link", { name: "Upload skill" }),
    ).toBeVisible();
  });

  test("has scope and view mode toggles", async ({ page }) => {
    await expect(page.getByLabel("Skill workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page.getByRole("radiogroup", { name: "Resource scope" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "View mode" }),
    ).toBeVisible();
  });
});
