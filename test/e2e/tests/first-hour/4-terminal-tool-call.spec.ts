// A developer's first hour, step four: the same tool from the terminal.
//
// What it proves: a developer signed out of their tool server (the plugin
// page's Sign out, which removes the login from My vault) signs in again
// from the terminal: `stigmer connect plugin` opens the login page through
// BROWSER, handed to the person's browser, which opens it with no opener
// and consents there; the login page returns to the console's callback
// page, which hands the answer to Stigmer, and the CLI, asking all along,
// collects it, prints whose login it saved and lists the server's tools.
// Then `stigmer run` on the agent, its events as NDJSON, carries the tool
// call whose result holds the step's nonce, through the login the terminal
// saved.
//
// `connect plugin` signs in only on an interactive terminal (off one it
// prints the ways instead), so it runs on a pseudo-terminal (helpers/cli.ts
// `terminal`).
//
// Stack shape: as the first step (tests/first-hour/1-sign-up-to-an-agent.spec.ts).
import { AGENT, TOOL, TOOL_AS_CALLED, TOOL_SERVER, expect, journeySkipReason, test } from "../../fixtures/first-hour";
import { askForTheTool, drainModel, expectCliSucceeded, nonce, resetModel, scriptToolCall, toolResults } from "../../helpers/first-hour/steps";

test.describe("a developer signs in to their tool server from the terminal, and the agent calls it there", () => {
  test.skip(journeySkipReason() !== null, journeySkipReason() ?? "");
  test.describe.configure({ mode: "serial", timeout: 600_000 });

  test("sign out on the plugin's page, `stigmer connect plugin` signs in through the browser, and `stigmer run` calls the tool", async ({ journey }) => {
    journey.require("terminal-tool-call");
    const { target, cli, page, context } = journey;

    await test.step("signs out of the tool server on the plugin's page", async () => {
      await page.goto(`/library/plugins/${journey.found.org ?? ""}/${TOOL_SERVER}`);
      await page.getByRole("button", { name: `Sign out of ${TOOL_SERVER}` }).click({ timeout: 30_000 });
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await expect(page.getByRole("button", { name: `Sign in to ${TOOL_SERVER}` })).toBeVisible({ timeout: 30_000 });
    });

    await test.step("`stigmer connect plugin` signs in through the person's browser and lists the tools", async () => {
      const connect = await cli.terminal(`stigmer connect plugin ${TOOL_SERVER}`, {
        timeoutMs: 180_000,
        onBrowser: async (url) => {
          // Opened as an address, not from a page: the login page has no opener.
          const login = await context.newPage();
          try {
            await login.goto(url);
            await login.getByRole("link", { name: "Allow" }).click({ timeout: 30_000 });
            await expect(login.getByRole("heading", { name: /^You're signed in at / })).toBeVisible({ timeout: 30_000 });
            await expect(login.getByText("Connected")).toHaveCount(0);
          } finally {
            await login.close();
          }
        },
      });
      expectCliSucceeded(connect);
      expect(connect.stdout, "the CLI says whose login it saved").toContain(`Signed in to '${TOOL_SERVER}'.`);
      expect(connect.stdout, "the CLI lists the server's tools").toMatch(new RegExp(`\\b${TOOL}\\b`));
    });

    await test.step("`stigmer run` calls the tool, and the call's result in its events carries the nonce", async () => {
      const value = nonce("terminal");
      await scriptToolCall(target.model, value, "call_first_hour_terminal");
      try {
        const run = await cli.line(`stigmer run ${AGENT} -o ndjson -m ${JSON.stringify(askForTheTool(value))}`, { timeoutMs: 300_000 });
        expectCliSucceeded(run);
        const results = toolResults(run.stdout, value);
        expect(results, `an event of the run shows ${TOOL_AS_CALLED}'s result carrying the nonce\n${run.stdout}`).not.toHaveLength(0);
        await drainModel(target.model);
      } finally {
        await resetModel(target.model);
      }
    });
    journey.reach("terminal-tool-call");
  });
});
