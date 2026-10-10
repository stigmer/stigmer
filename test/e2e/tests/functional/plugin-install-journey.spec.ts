import { test, expect, type Page } from "@playwright/test";
import {
  HOSTED_MARKETPLACE_NAME,
  HOSTED_PLUGIN,
  HOSTED_PLUGIN_DISPLAY_NAME,
  HOSTED_REPO,
  HOSTED_SERVER,
  HOSTED_SKILL,
  OAUTH_PLUGIN,
  OAUTH_SERVER,
  UPLOADED_PLUGIN,
  UPLOADED_SERVER,
  UPLOADED_SKILL,
  routeHostedMarketplace,
  writeUploadPluginDir,
} from "../../fixtures/hosted-marketplace";
import { getOAuthMcpFixture } from "../../fixtures/oauth-mcp";

const oauthMcp = getOAuthMcpFixture();

/**
 * The console's plugin journeys, end to end and hermetic. A plugin is one
 * thing, used whole: installing it creates nothing beside it, and its page
 * says what it holds. The Marketplace arm: open the Marketplace, see the
 * one built-in source as a chip (the official catalogue, honest about a
 * development server), see the Upload tile first in the grid, add a source
 * through Manage sources, find its card wearing the manifest's display
 * name, install from it, land on the plugin's page, read its MCP server
 * (with the key it reads and its tool names), its skill and its agent by
 * the names a turn uses, and the key it declares, then "Start a chat",
 * which opens the launcher with the plugin picked. The upload arm: hand a
 * plugin folder to the directory input as a browser would, read the same
 * preview, install, land on its page. No model is involved.
 *
 * The sign-in arm (STIGMER_E2E_OAUTH_MCP=1, `make test-e2e-oauth-mcp`): a
 * plugin whose one server is nothing but a URL installs; the control plane
 * completes its OAuth at save from the fixture's challenge; the plugin's
 * page carries Sign in; the popup consents through the fixture's login
 * server and the callback page; the row reads Signed in; Check tools lists
 * what the server offers now that the login is in My vault. No model runs
 * in this stack, so the tool call itself is the live proof's, not the
 * journey's. Skipped on a stack booted without the shape.
 *
 * Prerequisites:
 * - Local backend (auto-started by the Playwright global setup) and the web
 *   dev server (auto-started by the Playwright config).
 */

test.describe("Plugin install journey", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await routeHostedMarketplace(page, oauthMcp?.mcpUrl);
  });

  test("lists installed plugins and offers the three ways in", async ({ page }) => {
    await page.goto("/library/plugins");
    await expect(page.getByRole("heading", { level: 1, name: "Plugins" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Plugin workbench")).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse Marketplace" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload plugin" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add MCP server" }).first()).toBeVisible();
  });

  test("the Marketplace: the official catalogue, an added source, install from a card, the plugin's page, and Start a chat", async ({
    page,
  }) => {
    // One journey of several round trips; the default budget is for one page.
    test.setTimeout(120_000);
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible({ timeout: 15_000 });

    // The sources first, as chips: All sources, then the one built-in, the official catalogue, honest about
    // its read (it names the development build here), the page standing.
    const sources = page.getByRole("radiogroup", { name: "Sources" });
    const chips = sources.getByRole("radio");
    await expect(chips.nth(0)).toHaveAccessibleName("All sources");
    await expect(chips.nth(1)).toHaveAccessibleName("stigmer");
    await expect(chips).toHaveCount(2);
    const unreadable = page.getByRole("list", { name: "Sources that cannot be read" });
    await expect(unreadable.getByText(/development build/)).toBeVisible({ timeout: 15_000 });

    // The Upload tile is the first tile in the grid; uploading is one more place plugins come from.
    await expect(page.getByRole("list", { name: "Plugins" }).getByRole("button", { name: /Upload a plugin/ })).toBeVisible();

    // Sources: add one through Manage sources (its name comes from its marketplace file).
    await page.getByRole("button", { name: "Manage sources" }).click();
    const manage = page.getByRole("dialog", { name: "Sources" });
    // The user's own catalogue is behind its disclosure; the form opens on it.
    await manage.getByText("Add your own catalogue").click();
    await manage.getByRole("textbox", { name: "GitHub repository" }).fill(HOSTED_REPO);
    await manage.getByRole("button", { name: "Add source" }).click();
    await expect(manage.getByText(`Added source '${HOSTED_MARKETPLACE_NAME}'.`)).toBeVisible({ timeout: 15_000 });
    await manage.getByRole("button", { name: "Close" }).click();
    await expect(sources.getByRole("radio", { name: HOSTED_MARKETPLACE_NAME })).toBeVisible();

    // Its card in the grid wears the manifest's display name and names its source; Install opens the preview in the CLI's words.
    const card = page.getByRole("list", { name: "Plugins" }).getByRole("listitem").filter({ hasText: HOSTED_MARKETPLACE_NAME }).first();
    await expect(card.getByRole("heading", { level: 3 })).toHaveText(HOSTED_PLUGIN_DISPLAY_NAME, { timeout: 15_000 });
    await page.getByRole("button", { name: `Install ${HOSTED_PLUGIN}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Install ${HOSTED_PLUGIN}` })).toBeVisible();
    await expect(dialog.getByText(new RegExp(`From ${HOSTED_MARKETPLACE_NAME} `))).toBeVisible();
    await expect(dialog.getByText("Cursor plugin")).toBeVisible();
    await expect(dialog.getByText(`1: ${HOSTED_SKILL}`)).toBeVisible();
    await expect(dialog.getByText(`1: ${HOSTED_SERVER} (http)`)).toBeVisible();
    await expect(dialog.getByText("1: checker")).toBeVisible();
    await expect(dialog.getByText("1: API_TOKEN")).toBeVisible();

    // Install, then the plugin's page.
    const install = dialog.getByRole("button", { name: "Install", exact: true });
    await expect(install).toBeEnabled({ timeout: 15_000 });
    await install.click();
    await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${HOSTED_PLUGIN}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: HOSTED_PLUGIN })).toBeVisible({ timeout: 15_000 });
    await expectPluginHolds(page, HOSTED_PLUGIN, HOSTED_SKILL, HOSTED_SERVER);

    // The server reads a key, asked for when a conversation that uses it starts.
    const servers = page.getByRole("list", { name: "MCP servers", exact: true });
    await expect(servers.getByText(/asked for when a conversation that uses it starts/)).toBeVisible();
    await expect(servers.getByRole("button", { name: "Check tools" })).toBeVisible();
    await expect(page.getByRole("list", { name: "Keys this plugin reads" }).getByText("API_TOKEN")).toBeVisible();

    // "Start a chat" is the page's primary action: it opens the launcher with
    // the plugin picked, which the launcher reads once from `?plugin=` and
    // then drops from the address bar.
    await page.getByRole("button", { name: "Start a chat" }).first().click();
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });
    await page.getByRole("button", { name: "Configure agent, tools, and skills" }).click();
    await page.getByRole("menuitem", { name: /^Plugins/ }).click();
    await expect(page.getByRole("button", { name: `Remove ${HOSTED_PLUGIN}` })).toBeVisible({ timeout: 15_000 });
  });

  test("the Marketplace marks the installed plugin, and a second install of the same version reads as already installed", async ({
    page,
  }) => {
    // A fresh browser context remembers no added source; add it again.
    await page.goto("/marketplace");
    await page.getByRole("button", { name: "Manage sources" }).click();
    const manage = page.getByRole("dialog", { name: "Sources" });
    // The user's own catalogue is behind its disclosure; the form opens on it.
    await manage.getByText("Add your own catalogue").click();
    await manage.getByRole("textbox", { name: "GitHub repository" }).fill(HOSTED_REPO);
    await manage.getByRole("button", { name: "Add source" }).click();
    await expect(manage.getByText(`Added source '${HOSTED_MARKETPLACE_NAME}'.`)).toBeVisible({ timeout: 15_000 });
    await manage.getByRole("button", { name: "Close" }).click();
    const card = page.getByRole("button", { name: `Install ${HOSTED_PLUGIN}` });
    await expect(card).toHaveText("Install again", { timeout: 15_000 });
    await card.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/already installed; there is nothing to do/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("button", { name: "Install", exact: true })).toBeDisabled();
  });

  // Flaky in the gate: it waits for "Signed in" after swallowing the sign-in
  // popup's close timeout, and fails when the popup has not closed.
  // quarantined: stigmer/stigmer#1571
  test.skip("a URL-only OAuth server: completed at save, signed in from the plugin's page, its tools checked", async ({
    page,
    context,
  }) => {
    test.skip(oauthMcp === null, "Requires the OAuth MCP stack shape: run `make test-e2e-oauth-mcp` (STIGMER_E2E_OAUTH_MCP=1)");
    test.setTimeout(120_000);

    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Manage sources" }).click();
    const sources = page.getByRole("dialog", { name: "Sources" });
    await sources.getByText("Add your own catalogue").click();
    await sources.getByRole("textbox", { name: "GitHub repository" }).fill(HOSTED_REPO);
    await sources.getByRole("button", { name: "Add source" }).click();
    await expect(sources.getByText(`Added source '${HOSTED_MARKETPLACE_NAME}'.`)).toBeVisible({ timeout: 15_000 });
    await sources.getByRole("button", { name: "Close" }).click();

    // The card wears the manifest's display name; the preview names one server and no agent.
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Sign-in Kit" }) });
    await expect(card).toBeVisible({ timeout: 15_000 });
    await card.getByRole("button", { name: `Install ${OAUTH_PLUGIN}` }).click();
    const dialog = page.getByRole("dialog", { name: `Install ${OAUTH_PLUGIN}` });
    await expect(dialog.getByText(`1: ${OAUTH_SERVER} (http)`)).toBeVisible({ timeout: 15_000 });
    const install = dialog.getByRole("button", { name: "Install", exact: true });
    await expect(install).toBeEnabled({ timeout: 15_000 });
    await install.click();

    // The plugin's page: one server, not signed in, and Sign in beside it.
    await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${OAUTH_PLUGIN}$`), { timeout: 30_000 });
    const signIn = page.getByRole("button", { name: `Sign in to ${OAUTH_SERVER}` });
    await expect(signIn).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Not signed in")).toBeVisible();

    // The popup: the fixture's login server consents by redirect to the
    // console's callback page, which posts the code back and closes.
    const popupPromise = context.waitForEvent("page");
    await signIn.click();
    const popup = await popupPromise;
    await popup.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);
    await expect(page.getByText("Signed in")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: `Sign in to ${OAUTH_SERVER}` })).toHaveCount(0);

    // Check tools asks the server now, with the login My vault holds.
    await page.getByRole("button", { name: "Check tools" }).click();
    await expect(page.getByRole("list", { name: `Tools of ${OAUTH_SERVER}` }).getByRole("listitem").first()).toBeVisible({
      timeout: 30_000,
    });
  });

  test("Upload plugin: a folder handed to the directory input previews as the CLI would and installs", async ({ page }) => {
    test.setTimeout(90_000);
    const folder = writeUploadPluginDir();
    await page.goto("/library/plugins/upload");
    await expect(page.getByRole("heading", { level: 1, name: "Upload a plugin" })).toBeVisible({ timeout: 15_000 });

    // The directory input takes the folder; the browser names every file under it.
    await page.getByTestId("plugin-folder-input").setInputFiles(folder);

    await expect(page.getByRole("heading", { level: 2, name: `Install ${UPLOADED_PLUGIN}` })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`From the folder '${UPLOADED_PLUGIN}' into`)).toBeVisible();
    await expect(page.getByText("Cursor plugin")).toBeVisible();
    await expect(page.getByText(`1: ${UPLOADED_SKILL}`)).toBeVisible();
    await expect(page.getByText(`1: ${UPLOADED_SERVER} (http)`)).toBeVisible();

    const install = page.getByRole("button", { name: "Install", exact: true });
    await expect(install).toBeEnabled({ timeout: 15_000 });
    await install.click();
    await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${UPLOADED_PLUGIN}$`), { timeout: 30_000 });
    await expect(page.getByRole("heading", { level: 2, name: UPLOADED_PLUGIN })).toBeVisible({ timeout: 15_000 });
    await expectPluginHolds(page, UPLOADED_PLUGIN, UPLOADED_SKILL, UPLOADED_SERVER);
  });
});

/**
 * The plugin's page says what it holds, from the lists its status recorded
 * at install: the server with the tool names a turn uses
 * (`mcp__plugin_<plugin>_<server>__<tool>`), and the skill and the agent by
 * `<plugin>:<name>`. Nothing is installed beside the plugin, so there is
 * nothing else to open.
 */
async function expectPluginHolds(page: Page, plugin: string, skill: string, server: string): Promise<void> {
  const servers = page.getByRole("list", { name: "MCP servers", exact: true });
  await expect(servers.getByText(server, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(servers.getByText(/^mcp__plugin_.+__\*$/)).toBeVisible();
  const skills = page.getByRole("list", { name: "Skills", exact: true });
  await expect(skills.getByText(skill, { exact: true })).toBeVisible();
  await expect(skills.getByText(`${plugin}:${skill}`)).toBeVisible();
  const agents = page.getByRole("list", { name: "Agents", exact: true });
  await expect(agents.getByText("checker", { exact: true })).toBeVisible();
  await expect(agents.getByText(`${plugin}:checker`)).toBeVisible();
}
