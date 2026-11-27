// A developer's first hour, step five: a tool server written straight into
// an agent's own file signs in as a plugin's does.
//
// What it proves: the developer writes the tool server into a second agent's
// own `mcp_servers` (no plugin) and applies it; the save asks the server
// whether it wants a sign-in, and `stigmer apply` names it. The tutorial's
// app, pointed at that agent and signing in another of its users, offers
// that user "Sign in" for the server in the chat; once they sign in, their
// next message calls the tool with their own login, and the tool's result
// carries the step's nonce. Before an agent's own server was asked, the chat
// offered no sign-in and the run called the server with no login.
//
// The app user is another person than step three's (another id on the app's
// token route), so their My vault holds no login at the server's address and
// the chat must offer one. The app is the tutorial's, as step three runs it,
// with the reader's two edits: the agent's name and their user.
//
// Stack shape: as the first step (tests/first-hour/1-sign-up-to-an-agent.spec.ts).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL, expect, journeySkipReason, test } from "../../fixtures/first-hour";
import { APP_PORT, packKit, runTutorial, type TutorialRun } from "../../helpers/embed-tutorial";
import {
  askForTheTool,
  drainModel,
  expectCliSucceeded,
  expectToolResultInTimeline,
  nonce,
  prepareEmbedding,
  scriptToolCall,
} from "../../helpers/first-hour/steps";

/** The second agent, whose file writes the tool server itself. */
const OWN_AGENT = "ledger-helper";
/** The server's name in that agent's file: a turn calls its tools mcp__<name>__<tool>. */
const OWN_SERVER = "own-tools";
/** The login the server's sign-in saves, as a run asks for it by name. */
const LOGIN_KEY = "OWN_TOOLS_ACCESS_TOKEN";

test.describe("a tool server in an agent's own file signs its app user in", () => {
  test.skip(journeySkipReason() !== null, journeySkipReason() ?? "");
  test.describe.configure({ mode: "serial", timeout: 900_000 });

  let tutorial: TutorialRun | null = null;
  let folder = "";

  test.afterAll(() => {
    tutorial?.stop();
    if (folder !== "") rmSync(folder, { recursive: true, force: true });
  });

  test("apply names the server's sign-in, and the app's user signs in from the chat and calls its tool", async ({ journey, browser }) => {
    journey.require("agent-server-tool-call");
    const { target, cli } = journey;
    const org = journey.found.org ?? "";
    const toolServer = journey.found.toolServer;
    expect(toolServer, "the tool server the console step added").toBeDefined();

    await test.step("the developer writes the server into a second agent's file and applies it", async () => {
      const lines = [
        "apiVersion: agentic.stigmer.ai/v1",
        "kind: Agent",
        "metadata:",
        `  name: ${OWN_AGENT}`,
        "spec:",
        "  description: Answers with the app's own tools.",
        "  instructions: |",
        "    You help the app's users with the app's own tools. When asked to",
        "    call a tool, call it with exactly the text you were given.",
        "  mcp_servers:",
        `    - name: ${OWN_SERVER}`,
        `      url: ${toolServer!.mcpUrl}`,
        ...(toolServer!.reach === "loopback" ? ["  computer: COMPUTER_REQUIRED"] : []),
      ];
      writeFileSync(join(cli.workDir, `${OWN_AGENT}.yaml`), `${lines.join("\n")}\n`);
      const applied = await cli.line(`stigmer apply -f ${OWN_AGENT}.yaml`);
      expectCliSucceeded(applied);
      expect(`${applied.stdout}\n${applied.stderr}`, "apply names the server that signs in").toContain(`${OWN_SERVER} signs in`);
    });

    await test.step("the tutorial's app shows that agent to another of its users", async () => {
      const apiKey = await prepareEmbedding(journey, "report-backend-own-tools");
      folder = mkdtempSync(join(tmpdir(), "stigmer-first-hour-own-server-"));
      const kit =
        target.packages.kind === "checkout"
          ? packKit(join(folder, "tarballs"))
          : { version: target.packages.version, ...(target.packages.registry === undefined ? {} : { registry: target.packages.registry }) };
      tutorial = await runTutorial(join(folder, "reader"), kit, { apiUrl: target.apiUrl, apiKey, org }, undefined, (path, content) => {
        if (path.endsWith("App.tsx")) return content.replaceAll("/variance-reporter", `/${OWN_AGENT}`);
        if (path.endsWith("server.ts")) return content.replace(/id: "user_123", email: "[^"]+", name: "[^"]+"/, 'id: "user_456", email: "omar@example.com", name: "Omar"');
        return content;
      });
    });

    const appContext = await browser.newContext();
    try {
      const app = await appContext.newPage();
      await test.step("the chat offers the user Sign in for the agent's own server, and the sign-in finishes", async () => {
        await app.goto(`http://localhost:${APP_PORT}`);
        const signIn = app.getByRole("button", { name: `Sign in to ${OWN_SERVER}` });
        await expect(signIn, "the chat offers the agent's own server's sign-in").toBeVisible({ timeout: 60_000 });

        const opened = appContext.waitForEvent("page");
        await signIn.click();
        const popup = await opened;
        await popup.getByRole("link", { name: "Allow" }).click({ timeout: 30_000 });
        await expect(signIn).toHaveCount(0, { timeout: 60_000 });
      });

      await test.step("the user's next message calls the agent's own server's tool with their own sign-in", async () => {
        const value = nonce("own-server");
        await scriptToolCall(target.model, value, "call_first_hour_own_server", `mcp__${OWN_SERVER}__${TOOL}`);
        const composer = app.getByRole("textbox").first();
        await composer.fill(askForTheTool(value, OWN_SERVER));
        // As in step three: a send while the chat reads the agent again is
        // refused with "try again in a moment", which a person does.
        const stillLoading = app.getByText("This agent is still loading. Please try again in a moment.");
        for (let attempt = 1; ; attempt++) {
          await app.getByRole("button", { name: "Send message" }).click({ timeout: 30_000 });
          if (!(await stillLoading.isVisible({ timeout: 3_000 }).catch(() => false))) break;
          expect(attempt, "the agent finishes loading within a minute").toBeLessThan(20);
          await app.waitForTimeout(3_000);
        }

        await expectToolResultInTimeline(app, value, 120_000);
        await expect(
          app.getByText(new RegExp(`needs ${LOGIN_KEY}`)),
          "the message is never refused for the login the user signed in with",
        ).toHaveCount(0);
        await drainModel(target.model);
      });
    } finally {
      await appContext.close();
    }
    journey.reach("agent-server-tool-call");
  });
});
