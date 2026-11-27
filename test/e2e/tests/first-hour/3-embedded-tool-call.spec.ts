// A developer's first hour, step three: the agent in their own app, on its
// own address, its user signed in to the tool server from the chat.
//
// What it proves: the embedding tutorial's app (docs/getting-started/embed-agent.mdx),
// written from its page and installed from the target's packages, runs on
// its own address (Vite's, never the console's), and a person signed in to
// that app signs in to the tool server from the chat, through the login page
// with an opener policy: the chat finishes the sign-in itself, its sign-in
// row goes and the agent needs no more setup, and the window the login page
// returned to never says "Connected".
//
// Then the app user's next message calls the tool as that user: their run
// reads the login their own sign-in saved in their My vault (an app user's
// own turn reads the logins there, each for the tool at its address, after
// the conversation's and the embedding settings' vaults; stigmer/stigmer#3470),
// the tool's result carries the step's nonce, and the refusal naming the
// login key never shows.
//
// The earlier pages' state (the `report-backend` service account and its
// key, account creation on in the embedding settings) is made through the
// API as the person, as the embedding tutorial's own spec makes it.
//
// Stack shape: as the first step (tests/first-hour/1-sign-up-to-an-agent.spec.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_SERVER, expect, journeySkipReason, test } from "../../fixtures/first-hour";
import { APP_PORT, packKit, runTutorial, type TutorialRun } from "../../helpers/embed-tutorial";
import {
  askForTheTool,
  drainModel,
  expectToolResultInTimeline,
  nonce,
  prepareEmbedding,
  scriptToolCall,
} from "../../helpers/first-hour/steps";

/** The login the tool server's sign-in saves, as a run asks for it by name. */
const LOGIN_KEY = `${TOOL_SERVER.toUpperCase().replaceAll("-", "_")}_ACCESS_TOKEN`;

test.describe("a developer's app, on its own address, signs its user in to the tool server", () => {
  test.skip(journeySkipReason() !== null, journeySkipReason() ?? "");
  test.describe.configure({ mode: "serial", timeout: 900_000 });

  let tutorial: TutorialRun | null = null;
  let folder = "";

  test.afterAll(() => {
    tutorial?.stop();
    if (folder !== "") rmSync(folder, { recursive: true, force: true });
  });

  test("the tutorial's app signs its user in through the login page, and the next message calls the tool as that user", async ({ journey, browser }) => {
    journey.require("embedded-tool-call");
    const { target } = journey;
    const org = journey.found.org ?? "";

    await test.step("writes and starts the tutorial's app on its own address, from the target's packages", async () => {
      const apiKey = await prepareEmbedding(journey);
      folder = mkdtempSync(join(tmpdir(), "stigmer-first-hour-app-"));
      const kit =
        target.packages.kind === "checkout"
          ? packKit(join(folder, "tarballs"))
          : { version: target.packages.version, ...(target.packages.registry === undefined ? {} : { registry: target.packages.registry }) };
      tutorial = await runTutorial(join(folder, "reader"), kit, { apiUrl: target.apiUrl, apiKey, org });
    });

    const appContext = await browser.newContext();
    try {
      const app = await appContext.newPage();
      await test.step("the app's user signs in to the tool server from the chat, through the opener-policy login page", async () => {
        await app.goto(`http://localhost:${APP_PORT}`);
        const signIn = app.getByRole("button", { name: `Sign in to ${TOOL_SERVER}` });
        await expect(signIn).toBeVisible({ timeout: 60_000 });
        const needsSetup = app.getByText("Agent needs configuration before use");
        await expect(needsSetup).toBeVisible();

        const opened = appContext.waitForEvent("page");
        await signIn.click();
        const popup = await opened;
        await popup.getByRole("link", { name: "Allow" }).click({ timeout: 30_000 });

        await expect(signIn).toHaveCount(0, { timeout: 60_000 });
        await expect(needsSetup).toHaveCount(0, { timeout: 30_000 });
        if (!popup.isClosed()) {
          await expect(popup.getByRole("heading", { name: /^You're signed in at / })).toBeVisible();
          await expect(popup.getByText("Connected")).toHaveCount(0);
        }
      });

      await test.step("the user's next message calls the tool with the user's own sign-in", async () => {
        const value = nonce("embedded");
        await scriptToolCall(target.model, value, "call_first_hour_embedded");
        const composer = app.getByRole("textbox").first();
        await composer.fill(askForTheTool(value));
        // The chat reads the agent again after the sign-in; a message sent
        // while it does is refused with "try again in a moment", which a
        // person does (seen on a deployed Stigmer, where the read takes a
        // moment longer than on a local stack).
        const stillLoading = app.getByText("This agent is still loading. Please try again in a moment.");
        for (let attempt = 1; ; attempt++) {
          await app.getByRole("button", { name: "Send message" }).click({ timeout: 30_000 });
          if (!(await stillLoading.isVisible({ timeout: 3_000 }).catch(() => false))) break;
          expect(attempt, "the agent finishes loading within a minute").toBeLessThan(20);
          await app.waitForTimeout(3_000);
        }

        // The run reads the login the user's own sign-in saved: the tool's
        // result carries the nonce, and the refusal naming the key never shows.
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
    journey.reach("embedded-tool-call");
  });
});
