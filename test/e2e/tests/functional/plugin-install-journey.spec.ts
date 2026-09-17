import { test, expect } from "@playwright/test";
import {
  HOSTED_MARKETPLACE_NAME,
  HOSTED_PLUGIN,
  HOSTED_REPO,
  HOSTED_SERVER,
  HOSTED_SKILL,
  routeHostedMarketplace,
} from "../../fixtures/hosted-marketplace";

/**
 * The console's plugin journey, end to end and hermetic: add a GitHub
 * marketplace (its two hosts answered from fixtures), read what it offers,
 * install a plugin from the preview, land on the plugin's page, open a
 * session on its agent, and be asked for the variable the plugin's tool
 * needs, because the install declared it on the agent. "Starts a session"
 * is the session page opening; no model is involved.
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

  test("lists installed plugins and offers Install plugin", async ({ page }) => {
    await page.goto("/library/plugins");
    await expect(page.getByRole("heading", { level: 1, name: "Plugins" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Plugin workbench")).toBeVisible();
    await expect(page.getByRole("link", { name: "Install plugin" })).toBeVisible();
  });

  test("adds a marketplace, previews and installs a plugin, and the agent asks for its variable", async ({ page }) => {
    // One journey of several round trips; the default budget is for one page.
    test.setTimeout(120_000);
    await page.goto("/library/plugins/install");
    await expect(page.getByRole("heading", { level: 1, name: "Install a plugin" })).toBeVisible({ timeout: 15_000 });

    // The official tab is honest about a development server.
    await expect(page.getByText(/development build/)).toBeVisible();

    // marketplace add <source> --name <name>
    await page.getByRole("textbox", { name: "GitHub repository" }).fill(HOSTED_REPO);
    await page.getByRole("textbox", { name: "Name" }).fill(HOSTED_MARKETPLACE_NAME);
    await page.getByRole("button", { name: "Add marketplace" }).click();

    // marketplace show: the entry is offered.
    await expect(page.getByRole("tab", { name: HOSTED_MARKETPLACE_NAME })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText(`github.com/${HOSTED_REPO}`)).toBeVisible();
    await page.getByRole("button", { name: `Install ${HOSTED_PLUGIN}` }).click();

    // The preview in the CLI's words.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: `Install ${HOSTED_PLUGIN}` })).toBeVisible();
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

  test("a second install of the same version reads as already installed", async ({ page }) => {
    // A fresh browser context remembers no marketplace; add it again.
    await page.goto("/library/plugins/install");
    await page.getByRole("textbox", { name: "GitHub repository" }).fill(HOSTED_REPO);
    await page.getByRole("textbox", { name: "Name" }).fill(HOSTED_MARKETPLACE_NAME);
    await page.getByRole("button", { name: "Add marketplace" }).click();
    await page.getByRole("button", { name: `Install ${HOSTED_PLUGIN}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText(/already installed; there is nothing to do/)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole("button", { name: "Install", exact: true })).toBeDisabled();
  });
});
