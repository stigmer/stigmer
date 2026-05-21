import { test, expect } from "@playwright/test";

/**
 * MCP Servers list page structural tests.
 *
 * Verifies that /library/mcp-servers renders the correct heading, search,
 * workbench (cards or empty state), "Add MCP server" action link,
 * and the icon-only "Import from file" button.
 *
 * Prerequisites:
 * - Local dev server (auto-started by Playwright config)
 */

test.describe("MCP Servers list page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/library/mcp-servers");
  });

  test("renders heading and subtitle", async ({ page }) => {
    await expect(
      page.getByRole("heading", { level: 1, name: "MCP Servers" }),
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText(
        "Browse and manage MCP servers in your organization.",
      ),
    ).toBeVisible();
  });

  test("has search input with correct label", async ({ page }) => {
    await expect(
      page.getByRole("textbox", { name: "Search MCP servers\u2026" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("has workbench with cards or empty state", async ({ page }) => {
    await expect(page.getByLabel("MCP server workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page
        .getByRole("list", { name: "Resource cards" })
        .or(page.getByText("No MCP servers yet")),
    ).toBeVisible();
  });

  test("has Add MCP server action", async ({ page }) => {
    await expect(page.getByLabel("MCP server workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page.getByRole("link", { name: "Add MCP server" }),
    ).toBeVisible();
  });

  test("has import button", async ({ page }) => {
    await expect(page.getByLabel("MCP server workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page.getByRole("button", { name: "Import from file" }),
    ).toBeVisible();
  });
});
