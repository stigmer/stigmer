// A developer's first hour, step two: their agent calls their tool server,
// signed in from the console, in their own conversation.
//
// What it proves: the developer adds their tool server as the console adds
// one ("Add MCP server", a plugin of that one server, whose install finds
// it signs in), lists the plugin in the quickstart agent's file and applies
// it again, as a developer at their editor does; signs in from the plugin's
// page, through a login page with an opener policy (the window it opens is
// cut off from the console, as Sentry's is), and the plugin's page reads
// "Signed in"; and their conversation with the agent calls the server's
// tool through that login, the tool's result carrying the step's nonce.
// Between the two, Check tools lists what the server offers through the
// saved login (the plugin journey's sign-in arm checked it too).
//
// The sign-in window is awaited to close, and a window that stays open
// fails the step naming the page it stopped on, instead of failing later on
// a symptom (stigmer/stigmer#1571, which this step replaces: the plugin
// journey's sign-in arm swallowed that timeout).
//
// Stack shape: as the first step (tests/first-hour/1-sign-up-to-an-agent.spec.ts).
import { AGENT, TOOL, TOOL_SERVER, expect, journeySkipReason, test } from "../../fixtures/first-hour";
import {
  addToolServer,
  askForTheTool,
  drainModel,
  expectConversationStarted,
  expectToolResultInTimeline,
  listPluginInAgentFile,
  nonce,
  resetModel,
  scriptToolCall,
} from "../../helpers/first-hour/steps";

test.describe("a developer's agent calls their tool server, signed in from the console", () => {
  test.skip(journeySkipReason() !== null, journeySkipReason() ?? "");
  test.describe.configure({ mode: "serial", timeout: 600_000 });

  test("add the server, list its plugin in the agent's file, sign in from the plugin's page, and the conversation calls its tool", async ({ journey }) => {
    journey.require("console-tool-call");
    const { target, page, context } = journey;

    const toolServer = await test.step("adds the tool server as the console adds one", async () => {
      const found = await target.toolServer();
      journey.found.toolServer = found;
      await addToolServer(page, found);
      return found;
    });

    await test.step("lists its plugin in the agent's file and applies it again", async () => {
      await listPluginInAgentFile(journey, toolServer);
    });

    await test.step("signs in from the plugin's page, and the sign-in window closes", async () => {
      const signIn = page.getByRole("button", { name: `Sign in to ${TOOL_SERVER}`, exact: true });
      const opened = context.waitForEvent("page");
      await signIn.click();
      const popup = await opened;
      await popup.getByRole("link", { name: "Allow" }).click({ timeout: 30_000 });
      let lastUrl = popup.url();
      popup.on("framenavigated", (frame) => {
        if (frame === popup.mainFrame()) lastUrl = frame.url();
      });
      await popup.waitForEvent("close", { timeout: 30_000 }).catch((error: unknown) => {
        throw new Error(`the sign-in window did not close; it stopped on ${lastUrl}`, { cause: error });
      });
      await expect(page.getByText("Signed in", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(signIn).toHaveCount(0);
    });

    await test.step("Check tools asks the server with the saved login, and lists its tool", async () => {
      await page.getByRole("button", { name: "Check tools" }).click();
      await expect(page.getByRole("list", { name: `Tools of ${TOOL_SERVER}` }).getByText(TOOL, { exact: true })).toBeVisible({ timeout: 60_000 });
    });

    await test.step("the person's conversation with the agent calls the tool, and its result carries the nonce", async () => {
      const value = nonce("console");
      await scriptToolCall(target.model, value, "call_first_hour_console");
      try {
        await page.goto(`/library/agents/${journey.found.org ?? ""}/${AGENT}`);
        await page.getByRole("button", { name: "Start session" }).or(page.getByRole("link", { name: "Start session" })).first().click();
        const composer = page.getByRole("form", { name: "Start a new session" }).getByRole("textbox");
        await expect(composer).toBeVisible({ timeout: 30_000 });
        await composer.fill(askForTheTool(value));
        await page.getByRole("button", { name: "Send message" }).click();
        await expectConversationStarted(page);
        await expectToolResultInTimeline(page, value);
        await drainModel(target.model);
      } finally {
        await resetModel(target.model);
      }
    });
    journey.reach("console-tool-call");
  });
});
