import { test, expect } from "@playwright/test";
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
 * The console's plugin journeys, end to end and hermetic. The Marketplace
 * arm: open the Marketplace, see the one built-in source as a chip (the
 * official catalogue, honest about a development server), see the Upload tile first in
 * the grid, add a source through Manage sources, find its card wearing the
 * manifest's display name, install from it, land on the plugin's page,
 * open a session on its agent, and be asked for the variable the plugin's
 * tool needs, because the install declared it on the agent. The upload
 * arm: hand a plugin folder to the directory input as a browser would,
 * read the same preview, install, land on its page. "Starts a session" is
 * the session page opening; no model is involved.
 *
 * The sign-in arm (STIGMER_E2E_OAUTH_MCP=1, `make test-e2e-oauth-mcp`): a
 * plugin whose one server is nothing but a URL installs; the control plane
 * completes its OAuth at save from the fixture's challenge; the plugin's
 * page carries Sign in; the popup consents through the fixture's login
 * server and the callback page; the row reads Signed in; "Add to an agent"
 * hands the server to the agent wizard preselected. No model runs in this
 * stack, so the tool call itself is the live proof's, not the journey's.
 * Skipped on a stack booted without the shape.
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

  test("lists installed plugins and offers the two ways in", async ({ page }) => {
    await page.goto("/library/plugins");
    await expect(page.getByRole("heading", { level: 1, name: "Plugins" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Plugin workbench")).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse Marketplace" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload plugin" }).first()).toBeVisible();
  });

  test("the Marketplace: the official catalogue, an added source, install from a card, and the agent asks for its variable", async ({
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
    await expect(page.getByRole("button", { name: `Skill ${HOSTED_SKILL}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `MCP server ${HOSTED_SERVER}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Agent ${HOSTED_PLUGIN}` })).toBeVisible();

    const pluginUrl = page.url();

    // A member the plugin installed says so.
    await page.getByRole("button", { name: `Skill ${HOSTED_SKILL}` }).click();
    await expect(page.getByRole("note")).toContainText(`Installed by the plugin ${HOSTED_PLUGIN}`);

    // Start session is the plugin page's primary action when it carries an
    // agent. The launcher is driven through the URL the action computes
    // (the agent page's own Start session uses the same URL): a full load
    // binds the agent, where a client-side push into an already-mounted
    // launcher zone does not, which is the console's launcher behaviour
    // rather than this journey's subject.
    await page.goto(pluginUrl);
    await expect(page.getByRole("button", { name: "Start session" })).toBeVisible({ timeout: 15_000 });
    const org = new URL(pluginUrl).pathname.split("/")[3] ?? "";
    await page.goto(`/?agent=${encodeURIComponent(`${org}/${HOSTED_PLUGIN}`)}`);
    await expect(page.getByText("Enter required credentials to use this agent.")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("textbox", { name: "API_TOKEN secret" }).fill("test-token");
    await page.getByRole("button", { name: "Save" }).click();

    // The session is created and its page opens. Send stays disabled until
    // the agent has resolved after the save, so wait for it rather than
    // pressing Enter into a composer that would ignore it.
    const composer = page.getByRole("textbox", { name: "Describe what you need help with…" });
    await composer.fill("Is it warm in here?");
    const send = page.getByRole("button", { name: "Send message" });
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();
    await page.waitForURL(/\/sessions\/ses_/, { timeout: 30_000 });
    await expect(page.getByRole("article", { name: "User message" })).toContainText("Is it warm in here?");
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

  test("a URL-only OAuth server: completed at save, signed in from the plugin's page, handed to a new agent", async ({
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

    // The plugin's page: one server, Sign in, and the tools offered to an agent.
    await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${OAUTH_PLUGIN}$`), { timeout: 30_000 });
    const signIn = page.getByRole("button", { name: `Sign in to ${OAUTH_SERVER}` });
    await expect(signIn).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Sign-in required")).toBeVisible();
    await expect(page.getByText(/This plugin installed tools and no agent/)).toBeVisible();

    // The popup: the fixture's login server consents by redirect to the
    // console's callback page, which posts the code back and closes.
    const popupPromise = context.waitForEvent("page");
    await signIn.click();
    const popup = await popupPromise;
    await popup.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);
    await expect(page.getByText("Signed in")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: `Sign in to ${OAUTH_SERVER}` })).toHaveCount(0);

    // Add to an agent: a new one, with the server already chosen.
    await page.getByRole("button", { name: "Add to an agent" }).click();
    const add = page.getByRole("dialog", { name: "Add to an agent" });
    await expect(add.getByRole("list", { name: "Servers to add" })).toContainText(OAUTH_SERVER);
    await add.getByRole("button", { name: "Create a new agent with these tools" }).click();
    await page.waitForURL(new RegExp(`/library/agents/new\\?mcp=${OAUTH_SERVER}$`), { timeout: 15_000 });
    // The wizard opened directly on its first step, the picker skipped.
    const name = page.getByPlaceholder("e.g. PR Review Bot");
    await expect(name).toBeVisible({ timeout: 15_000 });
    await name.fill(`Sign-in agent ${OAUTH_PLUGIN}`);
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByText(OAUTH_SERVER)).toBeVisible({ timeout: 15_000 });
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
    await expect(page.getByRole("button", { name: `Agent ${UPLOADED_PLUGIN}` })).toBeVisible();
  });
});
