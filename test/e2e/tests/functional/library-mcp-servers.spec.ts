import { test, expect } from "../../fixtures";

/**
 * MCP Servers list page structural tests.
 *
 * Verifies that /library/mcp-servers renders the correct heading, search,
 * workbench (the empty state in an organization with no MCP server),
 * the "Add MCP server" action link, and the "Apply YAML" action.
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

  test("an organization with no MCP server shows the empty state and its call to action", async ({
    page,
    freshOrg,
  }) => {
    await page.goto("/library/mcp-servers");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(
      freshOrg.slug,
      { timeout: 15_000 },
    );

    const empty = page.getByRole("status").filter({ hasText: "No MCP servers yet" });
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty.getByRole("link", { name: "Add MCP server" })).toHaveAttribute(
      "href",
      "/library/mcp-servers/new",
    );
    await expect(page.getByRole("list", { name: "Resource cards" })).toHaveCount(0);
  });

  test("has the Add MCP server action", async ({ page }) => {
    await expect(page.getByLabel("MCP server workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(
      page.getByRole("link", { name: "Add MCP server" }).first(),
    ).toHaveAttribute("href", "/library/mcp-servers/new");
  });

  test("has the Apply YAML action", async ({ page }) => {
    await expect(page.getByLabel("MCP server workbench")).toBeVisible({
      timeout: 15_000,
    });

    await expect(page.getByRole("button", { name: "Apply YAML" })).toBeEnabled();
  });
});
