import { test, expect } from "../../fixtures";

/**
 * "Add MCP server" on the Plugins list: an MCP server lives in a plugin,
 * so adding one installs a plugin of that one server, built in the
 * browser. Pins the three places the form opens from (the list header,
 * the empty state of an organization with no plugin, and the Library Add
 * menu's `?add=mcp-server` link) and the add itself: a name, a URL and a
 * header naming a key as `${NAME}` install the plugin and land on its
 * page, which lists the server, the key it reads, and says the key is
 * asked for when a conversation that uses it starts. Every test runs in a
 * fresh organization so a rerun never reads "already installed".
 *
 * Prerequisites:
 * - Local backend (auto-started by the Playwright global setup) and the web
 *   dev server (auto-started by the Playwright config).
 */

/** Unique per run: a plugin's name is its identity in an organization. */
const SERVER = `orders-${Date.now().toString(36)}`;
const SERVER_URL = "https://orders.example.com/mcp";
const TOKEN = "ORDERS_TOKEN";

test.describe("Plugins list: Add MCP server", () => {
  test("an organization with no plugin offers Add MCP server in its empty state", async ({ page, freshOrg }) => {
    await page.goto("/library/plugins");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(freshOrg.slug, {
      timeout: 15_000,
    });

    const empty = page.getByRole("status").filter({ hasText: "No plugins installed" });
    await expect(empty).toBeVisible({ timeout: 15_000 });
    await expect(empty.getByRole("button", { name: "Add MCP server" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Resource cards" })).toHaveCount(0);
  });

  test("the Library Add menu's link opens the form on arrival", async ({ page, freshOrg }) => {
    await page.goto("/library/plugins?add=mcp-server");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(freshOrg.slug, {
      timeout: 15_000,
    });
    const dialog = page.getByRole("dialog", { name: "Add MCP server" });
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("adding a server installs a plugin of that one server and lands on its page", async ({ page, freshOrg }) => {
    test.setTimeout(60_000);
    await page.goto("/library/plugins");
    await expect(page.getByRole("button", { name: "Organization menu" })).toContainText(freshOrg.slug, {
      timeout: 15_000,
    });
    await expect(page.getByLabel("Plugin workbench")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Add MCP server" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Add MCP server" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Name", { exact: true }).fill(SERVER);
    await dialog.getByLabel("URL", { exact: true }).fill(SERVER_URL);
    await dialog.getByRole("button", { name: "Add header" }).click();
    await dialog.getByRole("textbox", { name: "Header name" }).fill("Authorization");
    await dialog.getByRole("textbox", { name: "Header value" }).fill(`Bearer \${${TOKEN}}`);
    const add = dialog.getByRole("button", { name: "Add", exact: true });
    await expect(add).toBeEnabled();
    await add.click();

    // The plugin is named after the server; its page lists the server, how it is reached, and the key it reads.
    await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${SERVER}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: SERVER })).toBeVisible({ timeout: 15_000 });
    const servers = page.getByRole("list", { name: "MCP servers", exact: true });
    await expect(servers.getByText(SERVER, { exact: true })).toBeVisible();
    await expect(servers.getByText(SERVER_URL)).toBeVisible();
    await expect(servers.getByText(/asked for when a conversation that uses it starts/)).toBeVisible();
    await expect(servers.getByRole("button", { name: "Check tools" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Keys this plugin reads" }).getByText(TOKEN)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start a chat" }).first()).toBeVisible();
  });
});
