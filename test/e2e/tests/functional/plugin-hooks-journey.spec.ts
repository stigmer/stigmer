import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { realPluginFiles } from "@stigmer/test-support/real-plugins";
import { test, expect } from "../../fixtures";

/**
 * A plugin's hooks in the console, end to end and hermetic, with Anthropic's
 * hookify as its authors published it (vendored under test/support). Upload
 * the folder and read its hooks in the preview; on the plugin's page, read
 * every command its PreToolUse and PostToolUse hooks run, and its Stop and
 * UserPromptSubmit hooks under "Not run on Stigmer"; put the plugin, whole,
 * on an agent the test made, through "Add to an agent"; read it in that
 * agent's Plugins section (its hooks come with it, so the agent's own Hooks
 * section stays the hooks written in the agent); try to remove the plugin
 * and be refused, naming the agent; take the plugin off the agent's page and
 * remove it. No model
 * runs: what a hook decides at a tool call is the approval lane's
 * (`interactive-approval/session-approval.spec.ts`) and execution
 * conformance's. Screenshots of the three surfaces go to the test's output.
 *
 * Prerequisites:
 * - Local backend (auto-started by the Playwright global setup) and the web
 *   dev server (auto-started by the Playwright config).
 */

const PLUGIN = "hookify";

/** hookify's files, as upstream lists them, in a folder named after the plugin, as a person would pick it. */
function writeHookifyDir(): string {
  const root = join(mkdtempSync(join(tmpdir(), "stigmer-e2e-hookify-")), PLUGIN);
  for (const [path, bytes] of realPluginFiles(PLUGIN)) {
    const full = join(root, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, bytes);
  }
  return root;
}

test.describe("Plugin hooks journey", () => {
  test("a plugin's hooks: read in the preview and on its page, the plugin put on an agent, and its removal refused until taken off", async ({
    page,
    stigmerClient,
    testAgent,
  }, testInfo) => {
    test.setTimeout(120_000);
    // A plugin a previous, failed run left behind would read "already installed".
    await stigmerClient.plugin
      .getByReference({ org: testAgent.org, slug: PLUGIN })
      .then((stale) => stigmerClient.plugin.delete(stale.metadata!.id))
      .catch(() => undefined);

    // The preview names the hooks in the CLI's words.
    await page.goto("/library/plugins/upload");
    await expect(page.getByRole("heading", { level: 1, name: "Upload a plugin" })).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("plugin-folder-input").setInputFiles(writeHookifyDir());
    await expect(page.getByRole("heading", { level: 2, name: `Install ${PLUGIN}` })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Claude Code format: PreToolUse 1, PostToolUse 1")).toBeVisible();
    const install = page.getByRole("button", { name: "Install", exact: true });
    await expect(install).toBeEnabled({ timeout: 15_000 });
    await install.click();

    // The plugin's page: every command its hooks run, and the hooks Stigmer does not run.
    await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${PLUGIN}$`), { timeout: 30_000 });
    const pluginUrl = page.url();
    const hooks = page.getByRole("list", { name: "Hooks (Claude Code format)" });
    await expect(hooks).toBeVisible({ timeout: 15_000 });
    await expect(hooks.getByText('python3 "${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse.py"')).toBeVisible();
    await expect(hooks.getByText('python3 "${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse.py"')).toBeVisible();
    await expect(hooks.getByText("Before a tool call")).toBeVisible();
    const notRun = page.getByRole("list", { name: "Hooks not run on Stigmer" });
    await expect(notRun.getByText(/'Stop'/)).toBeVisible();
    await expect(notRun.getByText(/'UserPromptSubmit'/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("plugin-page.png"), fullPage: true });

    // Put the plugin, whole, on the agent the test made.
    await page.getByRole("button", { name: "Add to an agent" }).click();
    const add = page.getByRole("dialog", { name: `Add ${PLUGIN} to an agent` });
    await expect(add.getByText("The agent gets the whole plugin: its skills, agents, hooks and MCP servers.", { exact: false })).toBeVisible();
    await add.getByRole("combobox").fill(testAgent.slug);
    await add.getByRole("option", { name: new RegExp(testAgent.slug) }).click();
    const addButton = add.getByRole("button", { name: "Add", exact: true });
    await expect(addButton).toBeEnabled({ timeout: 15_000 });
    await page.screenshot({ path: testInfo.outputPath("add-to-agent.png") });
    await addButton.click();
    await expect(add.getByRole("status")).toContainText(`Added ${PLUGIN} to `, { timeout: 15_000 });
    await add.getByRole("button", { name: "Open agent" }).click();

    // The agent's page lists the plugin; its hooks are read on the plugin's page, and none is written in the agent.
    await page.waitForURL(new RegExp(`/library/agents/[^/]+/${testAgent.slug}$`), { timeout: 15_000 });
    await expect(page.getByRole("button", { name: PLUGIN, exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("list", { name: "Hook sources" })).toHaveCount(0);
    const agentUrl = page.url();
    await page.screenshot({ path: testInfo.outputPath("agent-page.png"), fullPage: true });

    // Removing the plugin is refused while the agent lists it.
    await page.goto(pluginUrl);
    await removePlugin(page);
    await expect(page.getByText(new RegExp(`still used by agent '${testAgent.slug}'; remove it from their plugins first`))).toBeVisible({
      timeout: 15_000,
    });
    await expect(page).toHaveURL(pluginUrl);

    // Take it off on the agent's page; the removal then goes through.
    await page.goto(agentUrl);
    await page.getByRole("button", { name: "Edit plugins" }).click();
    await page.getByRole("button", { name: `Remove ${PLUGIN}` }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("No plugins configured")).toBeVisible({ timeout: 15_000 });

    await page.goto(pluginUrl);
    await removePlugin(page);
    await page.waitForURL(/\/library\/plugins$/, { timeout: 15_000 });
  });
});

/** The plugin page's kebab Remove, confirmed. */
async function removePlugin(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 2, name: PLUGIN })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: /More actions|Actions/ }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove" }).click();
}
