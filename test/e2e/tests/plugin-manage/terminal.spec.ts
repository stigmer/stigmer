// Every way to manage a plugin, from the terminal, after a developer's
// first hour: the same flows the console spec walks, through the real CLI,
// each proven by what the person gets.
//
// What it proves:
//   - `stigmer mcp add` installs a plugin of one server, shared with the
//     Organization and described; run again with a new address it upgrades
//     that plugin, keeping its visibility and description;
//   - `stigmer get plugin` prints the plugin's story: how to sign in again,
//     how to save a key, and why its name is fixed;
//   - `stigmer connect plugin` signs in through the browser, after the
//     login at the address was removed (`stigmer vault remove-connection`,
//     the terminal's sign-out), and `--sign-in-again` replaces the login
//     it saved: My vault's login at the address is saved again, later;
//   - `stigmer vault set-secret --mine` saves the key the header names;
//   - an agent file listing the plugin, applied, and `stigmer run` calls
//     the tool, its result in the run's events carrying the step's nonce;
//   - `stigmer delete plugin` is refused while the agent lists it, naming
//     the agent, and done once it does not;
//   - `stigmer mcp add` over a plugin pushed from a folder is refused,
//     saying so, and pushes nothing.
//
// `connect plugin` signs in only on an interactive terminal, so it runs on
// a pseudo-terminal (helpers/cli.ts `terminal`).
//
// Stack shape: the first-hour stack (`make test-e2e-first-hour`), after the
// journey and the console spec, as the person of fixtures/plugin-manage.ts.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { timestampMs } from "@bufbuild/protobuf/wkt";
import { isNotFound, type Stigmer } from "@stigmer/client";
import type { JourneyCli } from "../../helpers/cli";
import { agentFile, expect, manageSkipReason, test } from "../../fixtures/plugin-manage";
import { askForTheTool, drainModel, expectCliSucceeded, nonce, resetModel, scriptToolCall, toolResults } from "../../helpers/first-hour/steps";

const PLUGIN = "manage-term";
const FOLDER_PLUGIN = "manage-folder";
const AGENT = "manage-term-agent";
const KEY = "TERM_TEAM";
const TOOL_AS_CALLED = `mcp__plugin_${PLUGIN}_${PLUGIN}__echo`;

/** `stigmer get plugin <name> -o json`, as far as these steps read it. */
interface PluginJson {
  readonly metadata?: { readonly visibility?: string };
  readonly spec?: { readonly description?: string };
  readonly status?: {
    readonly digest?: string;
    readonly mcpServers?: readonly { readonly http?: { readonly url?: string } }[];
  };
}

async function getPluginJson(cli: JourneyCli, name: string): Promise<PluginJson> {
  const got = await cli.line(`stigmer get plugin ${name} -o json`);
  expectCliSucceeded(got);
  return JSON.parse(got.stdout) as PluginJson;
}

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

/** `stigmer connect plugin` on a pseudo-terminal, its login page answered with Allow in the person's browser. */
async function connect(cli: JourneyCli, context: BrowserContext, flags = ""): Promise<string> {
  const result = await cli.terminal(`stigmer connect plugin ${PLUGIN}${flags}`, {
    timeoutMs: 180_000,
    onBrowser: async (url) => {
      const login = await context.newPage();
      try {
        await login.goto(url);
        await login.getByRole("link", { name: "Allow" }).click({ timeout: 30_000 });
        await expect(login.getByRole("heading", { name: /^You're signed in at / })).toBeVisible({ timeout: 30_000 });
      } finally {
        await login.close();
      }
    },
  });
  expectCliSucceeded(result);
  return result.stdout;
}

test.describe("a developer manages a plugin from the terminal", () => {
  test.skip(manageSkipReason() !== null, manageSkipReason() ?? "");
  test.describe.configure({ mode: "serial", timeout: 600_000 });

  test("mcp add, change address, get, sign in and again, save a key, use from an agent, delete, and a folder plugin kept whole", async ({ manager }) => {
    const { cli, context, org, first, second, target } = manager;
    const person = await manager.asPerson();

    await test.step("`stigmer mcp add` installs the server, shared and described", async () => {
      expectCliSucceeded(
        await cli.line(`stigmer mcp add ${PLUGIN} ${first} --header 'X-Team=\${${KEY}}' --visibility org --description "Term tools."`),
      );
      const added = await getPluginJson(cli, PLUGIN);
      expect(added.status?.mcpServers?.[0]?.http?.url).toBe(first);
    });

    await test.step("`stigmer mcp add` again with a new address upgrades it, keeping its visibility and description", async () => {
      expectCliSucceeded(await cli.line(`stigmer mcp add ${PLUGIN} ${second} --header 'X-Team=\${${KEY}}'`));
      const changed = await getPluginJson(cli, PLUGIN);
      expect(changed.status?.mcpServers?.[0]?.http?.url, "the installed version is at the new address").toBe(second);
      expect(changed.metadata?.visibility, "the upgrade kept the plugin shared with the Organization").toBe("visibility_org");
      expect(changed.spec?.description, "the upgrade kept the description").toBe("Term tools.");
    });

    await test.step("`stigmer get plugin` says how to sign in again, how to save the key, and why the name is fixed", async () => {
      const view = await cli.line(`stigmer get plugin ${PLUGIN}`);
      expectCliSucceeded(view);
      expect(view.stdout).toContain(`stigmer vault set-secret ${KEY} --mine`);
      expect(view.stdout).toContain(`stigmer delete plugin ${PLUGIN}`);
      expect(view.stdout).toMatch(/so it doesn't change\. To use another name, add it again under that name/);
    });

    await test.step("`stigmer connect plugin` signs in through the browser, once the login at the address is removed", async () => {
      // The console spec signed this person in at the second address; the
      // terminal's sign-out removes that login first.
      if ((await loginSavedAt(person, org, second)) !== null) {
        expectCliSucceeded(await cli.line(`stigmer vault remove-connection ${second} --mine --force`));
      }
      expect(await loginSavedAt(person, org, second), "no login is saved at the address").toBeNull();
      const stdout = await connect(cli, context);
      expect(stdout, "the CLI says whose login it saved").toContain(`Signed in to '${PLUGIN}'.`);
      expect(await loginSavedAt(person, org, second), "My vault holds a login at the address").not.toBeNull();
      const view = await cli.line(`stigmer get plugin ${PLUGIN}`);
      expect(view.stdout, "the view offers the sign-in again beside a saved sign-in").toContain(`stigmer connect plugin ${PLUGIN} --sign-in-again`);
    });

    await test.step("`stigmer connect plugin --sign-in-again` replaces the saved login", async () => {
      const before = await loginSavedAt(person, org, second);
      const stdout = await connect(cli, context, " --sign-in-again");
      expect(stdout).toContain(`Signed in to '${PLUGIN}'.`);
      expect(await loginSavedAt(person, org, second), "the login at the address is saved again, later").toBeGreaterThan(before ?? 0);
    });

    await test.step("`stigmer vault set-secret --mine` saves the key the header names", async () => {
      expectCliSucceeded(await cli.line(`printf team-term | stigmer vault set-secret ${KEY} --mine`));
      const mine = await person.vault.getMine({ org });
      expect(Object.keys(mine.spec?.secrets ?? {}), "My vault holds the key").toContain(KEY);
    });

    await test.step("an agent file lists the plugin, and `stigmer run` calls its tool, the result carrying the nonce", async () => {
      writeFileSync(join(cli.workDir, `${AGENT}.yaml`), agentFile(AGENT, [PLUGIN]));
      expectCliSucceeded(await cli.line(`stigmer apply -f ${AGENT}.yaml`));
      const value = nonce("manage-terminal");
      await scriptToolCall(target.model, value, "call_plugin_manage_terminal", TOOL_AS_CALLED);
      try {
        const run = await cli.line(`stigmer run ${AGENT} -o ndjson -m ${JSON.stringify(askForTheTool(value, PLUGIN))}`, { timeoutMs: 300_000 });
        expectCliSucceeded(run);
        const results = toolResults(run.stdout, value, TOOL_AS_CALLED);
        expect(results, `an event of the run shows ${TOOL_AS_CALLED}'s result carrying the nonce\n${run.stdout}`).not.toHaveLength(0);
        await drainModel(target.model);
      } finally {
        await resetModel(target.model);
      }
    });

    await test.step("`stigmer delete plugin` is refused while the agent lists it, naming the agent", async () => {
      const refused = await cli.line(`stigmer delete plugin ${PLUGIN} --force`);
      expect(refused.status, "the delete is refused").not.toBe(0);
      expect(`${refused.stdout}${refused.stderr}`).toContain(AGENT);
      expect((await getPluginJson(cli, PLUGIN)).status?.digest, "the plugin is still installed").toBeTruthy();
    });

    await test.step("`stigmer delete plugin` is done once no agent lists it", async () => {
      writeFileSync(join(cli.workDir, `${AGENT}.yaml`), agentFile(AGENT, []));
      expectCliSucceeded(await cli.line(`stigmer apply -f ${AGENT}.yaml`));
      expectCliSucceeded(await cli.line(`stigmer delete plugin ${PLUGIN} --force`));
      const gone = await person.plugin.getByReference({ org, slug: PLUGIN }).then(
        () => false,
        (error: unknown) => isNotFound(error),
      );
      expect(gone, "the plugin is no longer installed").toBe(true);
      expectCliSucceeded(await cli.line(`stigmer delete agent ${AGENT} --force`));
    });

    await test.step("`stigmer mcp add` over a plugin pushed from a folder is refused and pushes nothing", async () => {
      const dir = join(cli.workDir, FOLDER_PLUGIN);
      mkdirSync(join(dir, ".claude-plugin"), { recursive: true });
      mkdirSync(join(dir, "skills", "hello"), { recursive: true });
      writeFileSync(join(dir, ".claude-plugin", "plugin.json"), `${JSON.stringify({ name: FOLDER_PLUGIN, description: "A folder." }, null, 2)}\n`);
      writeFileSync(join(dir, "skills", "hello", "SKILL.md"), "---\nname: hello\ndescription: Says hello.\n---\n\nSay hello.\n");
      expectCliSucceeded(await cli.line(`stigmer push plugin ${FOLDER_PLUGIN}`));
      const before = (await getPluginJson(cli, FOLDER_PLUGIN)).status?.digest;

      const refused = await cli.line(`stigmer mcp add ${FOLDER_PLUGIN} ${first}`);
      expect(refused.status, "mcp add over a folder plugin is refused").not.toBe(0);
      expect(`${refused.stdout}${refused.stderr}`).toContain("was pushed from a folder");
      expect((await getPluginJson(cli, FOLDER_PLUGIN)).status?.digest, "nothing was pushed").toBe(before);
      expectCliSucceeded(await cli.line(`stigmer delete plugin ${FOLDER_PLUGIN} --force`));
    });
  });
});
