// Every way to manage a plugin, in the console, after a developer's first
// hour: add a server, change its address, save its key, sign in, use it
// from an agent, sign in again, and remove it, each proven by what the
// person gets, never by a screen appearing.
//
// What it proves:
//   - Add MCP server installs a plugin of one server, whose page reads the
//     key its header names as not in My vault;
//   - Change address, on a plugin shared with the Organization, moves it to
//     a second address: its row asks for a sign-in there, and the plugin is
//     still shared (a push that named no visibility would have reset it);
//   - Save to My vault saves the key, which the page then reads as saved;
//   - Sign in, through the login window, at the new address; then an
//     agent given the plugin with "Add to an agent" calls its tool in a
//     conversation, the tool's result carrying the step's nonce;
//   - Sign in again replaces the login: My vault's login at the address is
//     saved again, later;
//   - Remove is refused while an agent lists the plugin, naming the agent,
//     and done once it does not; the page gives the terminal's command for
//     it and says why the name is fixed, which is how a plugin reaches a
//     new name.
//
// Stack shape: the first-hour stack (`make test-e2e-first-hour`), after the
// journey, as the person of fixtures/plugin-manage.ts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { isNotFound, type Stigmer } from "@stigmer/client";
import { agentFile, consentInPopup, expect, manageSkipReason, test } from "../../fixtures/plugin-manage";
import {
  askForTheTool,
  drainModel,
  expectCliSucceeded,
  expectConversationStarted,
  expectToolResultInTimeline,
  nonce,
  resetModel,
  scriptToolCall,
} from "../../helpers/first-hour/steps";

const PLUGIN = "manage-console";
const AGENT = "manage-console-agent";
const KEY = "MANAGE_TEAM";
const TOOL_AS_CALLED = `mcp__plugin_${PLUGIN}_${PLUGIN}__echo`;

/** The login My vault holds at `url`'s address, read as the person: when it was saved, or null when there is none. */
async function loginSavedAt(person: Stigmer, org: string, url: string): Promise<number | null> {
  const mine = await person.vault.getMine({ org }).catch((error: unknown) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  const host = new URL(url).host;
  const login = Object.entries(mine?.spec?.connections ?? {}).find(([address]) => address.includes(host))?.[1];
  return login?.savedAt === undefined ? null : timestampMs(login.savedAt);
}

test.describe("a developer manages a plugin in the console", () => {
  test.skip(manageSkipReason() !== null, manageSkipReason() ?? "");
  test.describe.configure({ mode: "serial", timeout: 600_000 });

  test("add, change address, save a key, sign in, use from an agent, sign in again, remove", async ({ manager }) => {
    const { page, context, cli, org, first, second, target } = manager;
    const person = await manager.asPerson();
    const pluginPage = `/library/plugins/${org}/${PLUGIN}`;

    await test.step("adds the server, its header naming a key", async () => {
      await page.goto("/library/plugins?add=mcp-server");
      const add = page.getByRole("dialog", { name: "Add MCP server" });
      await expect(add).toBeVisible({ timeout: 30_000 });
      await add.getByLabel("Name").fill(PLUGIN);
      await add.getByLabel("URL").fill(first);
      await add.getByRole("button", { name: "Add header" }).click();
      await add.getByLabel("Header name").fill("X-Team");
      await add.getByLabel("Header value").fill(`\${${KEY}}`);
      await add.getByRole("button", { name: "Add", exact: true }).click();
      await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${PLUGIN}$`), { timeout: 60_000 });
      // The journey's person may hold a login at the first address already, so
      // the row's sign-in state is not this step's; the plugin is.
      const added = await person.plugin.getByReference({ org, slug: PLUGIN });
      expect(Object.keys(added.status?.env ?? {}), "the plugin declares the key its header names").toContain(KEY);
    });

    await test.step("shares it with the Organization", async () => {
      const plugin = await person.plugin.getByReference({ org, slug: PLUGIN });
      await person.plugin.updateVisibility({ resourceId: plugin.metadata?.id ?? "", visibility: ApiResourceVisibility.visibility_org });
    });

    await test.step("changes its address: the row asks for a sign-in at the new one, and it is still shared", async () => {
      await page.goto(pluginPage);
      await page.getByRole("button", { name: `Change the address of ${PLUGIN}` }).click({ timeout: 30_000 });
      const change = page.getByRole("dialog", { name: `Change ${PLUGIN}` });
      await expect(change.getByLabel("URL")).toHaveValue(first);
      await change.getByLabel("URL").fill(second);
      await change.getByRole("button", { name: "Save", exact: true }).click();
      await expect(change).toHaveCount(0, { timeout: 60_000 });
      await expect(page.getByText(second, { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByRole("button", { name: `Sign in to ${PLUGIN}` })).toBeVisible({ timeout: 30_000 });

      const changed = await person.plugin.getByReference({ org, slug: PLUGIN });
      const server = changed.status?.mcpServers[0];
      expect(server?.transport.case === "http" ? server.transport.value.url : "", "the installed version is at the new address").toBe(second);
      expect(changed.metadata?.visibility, "the change kept the plugin shared with the Organization").toBe(ApiResourceVisibility.visibility_org);
    });

    await test.step("saves its key to My vault, and the page reads it as saved", async () => {
      const keys = page.getByRole("list", { name: "Keys this plugin reads" });
      const row = keys.getByRole("listitem").filter({ hasText: KEY });
      await expect(row.getByText("Not in My vault")).toBeVisible({ timeout: 30_000 });
      await row.getByRole("button", { name: `Save ${KEY} to My vault` }).click();
      await row.getByLabel(`Value of ${KEY}`).fill("team-console");
      await row.getByRole("button", { name: "Save", exact: true }).click();
      await expect(row.getByText("Saved in My vault")).toBeVisible({ timeout: 30_000 });
      const mine = await person.vault.getMine({ org });
      expect(Object.keys(mine.spec?.secrets ?? {}), "My vault holds the key").toContain(KEY);
    });

    await test.step("signs in at the new address", async () => {
      const opened = context.waitForEvent("page");
      await page.getByRole("button", { name: `Sign in to ${PLUGIN}` }).click();
      await consentInPopup(await opened);
      await expect(page.getByRole("button", { name: `Sign in to ${PLUGIN} again` })).toBeVisible({ timeout: 30_000 });
      expect(await loginSavedAt(person, org, second), "My vault holds a login at the new address").not.toBeNull();
    });

    await test.step("gives it to an agent with Add to an agent", async () => {
      writeFileSync(join(cli.workDir, `${AGENT}.yaml`), agentFile(AGENT, []));
      expectCliSucceeded(await cli.line(`stigmer apply -f ${AGENT}.yaml`));
      await page.goto(pluginPage);
      await page.getByRole("button", { name: "Add to an agent" }).click();
      const dialog = page.getByRole("dialog", { name: `Add ${PLUGIN} to an agent` });
      await dialog.getByRole("combobox").fill(AGENT);
      await dialog.getByRole("option").filter({ hasText: AGENT }).first().click({ timeout: 30_000 });
      await dialog.getByRole("button", { name: "Add", exact: true }).click();
      await expect(dialog.getByRole("status")).toContainText(`Added ${PLUGIN}`, { timeout: 30_000 });
      await dialog.getByRole("button", { name: "Close" }).click();
      const agent = await person.agent.getByReference({ org, slug: AGENT });
      expect(agent.spec?.plugins.map((ref) => ref.slug), "the agent lists the plugin").toContain(PLUGIN);
    });

    await test.step("the agent's conversation calls the tool at the new address, and its result carries the nonce", async () => {
      const value = nonce("manage-console");
      await scriptToolCall(target.model, value, "call_plugin_manage_console", TOOL_AS_CALLED);
      try {
        await page.goto(`/library/agents/${org}/${AGENT}`);
        await page.getByRole("button", { name: "Start session" }).or(page.getByRole("link", { name: "Start session" })).first().click();
        const composer = page.getByRole("form", { name: "Start a new session" }).getByRole("textbox");
        await expect(composer).toBeVisible({ timeout: 30_000 });
        await composer.fill(askForTheTool(value, PLUGIN));
        await page.getByRole("button", { name: "Send message" }).click();
        await expectConversationStarted(page);
        await expectToolResultInTimeline(page, value);
        await drainModel(target.model);
      } finally {
        await resetModel(target.model);
      }
    });

    await test.step("signs in again, which replaces the saved login", async () => {
      const before = await loginSavedAt(person, org, second);
      await page.goto(pluginPage);
      const opened = context.waitForEvent("page");
      await page.getByRole("button", { name: `Sign in to ${PLUGIN} again` }).click({ timeout: 30_000 });
      await consentInPopup(await opened);
      await expect
        .poll(() => loginSavedAt(person, org, second), { timeout: 30_000, message: "the login at the address is saved again, later" })
        .toBeGreaterThan(before ?? 0);
    });

    await test.step("says how it is removed, and why its name is fixed", async () => {
      await expect(page.getByText(`stigmer delete plugin ${PLUGIN}`, { exact: true })).toBeVisible();
      await expect(page.getByText(/so\s+it doesn't change\. To use another name, add it again under that name/)).toBeVisible();
    });

    await test.step("Remove is refused while the agent lists it, naming the agent", async () => {
      await removeFromMenu(page);
      await expect(page.locator("[data-sonner-toast]").filter({ hasText: AGENT }).first()).toBeVisible({ timeout: 30_000 });
      expect((await person.plugin.getByReference({ org, slug: PLUGIN })).metadata?.slug, "the plugin is still installed").toBe(PLUGIN);
    });

    await test.step("Remove is done once no agent lists it", async () => {
      writeFileSync(join(cli.workDir, `${AGENT}.yaml`), agentFile(AGENT, []));
      expectCliSucceeded(await cli.line(`stigmer apply -f ${AGENT}.yaml`));
      await page.goto(pluginPage);
      await removeFromMenu(page);
      await page.waitForURL(/\/library\/plugins$/, { timeout: 60_000 });
      const gone = await person.plugin.getByReference({ org, slug: PLUGIN }).then(
        () => false,
        (error: unknown) => isNotFound(error),
      );
      expect(gone, "the plugin is no longer installed").toBe(true);
      expectCliSucceeded(await cli.line(`stigmer delete agent ${AGENT} --force`));
    });
  });
});

/** Remove from the page's More actions, confirmed. */
async function removeFromMenu(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "More actions" }).click({ timeout: 30_000 });
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("alertdialog").or(page.getByRole("dialog")).getByRole("button", { name: "Remove", exact: true }).click();
}
