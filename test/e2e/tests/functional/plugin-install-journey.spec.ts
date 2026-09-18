import { test, expect } from "@playwright/test";
import {
  HOSTED_MARKETPLACE_NAME,
  HOSTED_PLUGIN,
  HOSTED_REPO,
  HOSTED_SERVER,
  HOSTED_SKILL,
  UPLOADED_PLUGIN,
  UPLOADED_SERVER,
  UPLOADED_SKILL,
  routeHostedMarketplace,
  writeUploadPluginDir,
} from "../../fixtures/hosted-marketplace";

/**
 * The console's plugin journeys, end to end and hermetic. The Marketplace
 * arm: open the Marketplace, see the built-in sources (the official one
 * honest about a development server, the vendors answered 404 by the
 * fixture and honest about that), add a source through the Sources panel,
 * install a plugin from its section's card, land on the plugin's page,
 * open a session on its agent, and be asked for the variable the plugin's
 * tool needs, because the install declared it on the agent. The upload
 * arm: hand a plugin folder to the directory input as a browser would,
 * read the same preview, install, land on its page. "Starts a session" is
 * the session page opening; no model is involved.
 *
 * Prerequisites:
 * - Local backend (auto-started by the Playwright global setup) and the web
 *   dev server (auto-started by the Playwright config).
 */

test.describe("Plugin install journey", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await routeHostedMarketplace(page);
  });

  test("lists installed plugins and offers the two ways in", async ({ page }) => {
    await page.goto("/library/plugins");
    await expect(page.getByRole("heading", { level: 1, name: "Plugins" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Plugin workbench")).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse Marketplace" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Upload plugin" }).first()).toBeVisible();
  });

  test("the Marketplace: built-in sources, an added source, install from a card, and the agent asks for its variable", async ({
    page,
  }) => {
    // One journey of several round trips; the default budget is for one page.
    test.setTimeout(120_000);
    await page.goto("/marketplace");
    await expect(page.getByRole("heading", { level: 1, name: "Marketplace" })).toBeVisible({ timeout: 15_000 });

    // The built-in sections, official first; each honest in its own section, the page standing.
    const sections = page.getByRole("heading", { level: 2 });
    await expect(sections.nth(0)).toHaveText("stigmer");
    await expect(sections.nth(1)).toHaveText("cursor-plugins");
    await expect(page.getByText(/development build/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/cursor-plugins cannot be read right now/)).toBeVisible({ timeout: 15_000 });

    // Sources: add one (its name comes from its marketplace file).
    await page.getByText(/^Sources \(/).click();
    await page.getByRole("textbox", { name: "GitHub repository" }).fill(HOSTED_REPO);
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(page.getByText(`Added source '${HOSTED_MARKETPLACE_NAME}'.`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { level: 2, name: HOSTED_MARKETPLACE_NAME })).toBeVisible();

    // The section's card, then the preview in the CLI's words.
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
    await page.getByText(/^Sources \(/).click();
    await page.getByRole("textbox", { name: "GitHub repository" }).fill(HOSTED_REPO);
    await page.getByRole("button", { name: "Add source" }).click();
    const card = page.getByRole("button", { name: `Install ${HOSTED_PLUGIN}` });
    await expect(card).toHaveText("Install again", { timeout: 15_000 });
    await card.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/already installed; there is nothing to do/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("button", { name: "Install", exact: true })).toBeDisabled();
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
