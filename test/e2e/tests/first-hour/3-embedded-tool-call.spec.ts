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
// Then the app user's next message, which should call the tool. Today their
// run never reads the login their sign-in saved (stigmer/stigmer#3470: an app
// user's runs read only the vaults on the Organization's embedding
// settings), and the message is refused, naming the key it lacks. The step
// holds that as a known gap (@stigmer/test-support/known-gap): it passes
// while the refusal is exactly that, and fails the day the tool call
// arrives, so the fix's pull request turns this into the assertion.
//
// The earlier pages' state (the `report-backend` service account and its
// key, account creation on in the embedding settings) is made through the
// API as the person, as the embedding tutorial's own spec makes it.
//
// Stack shape: as the first step (tests/first-hour/1-sign-up-to-an-agent.spec.ts).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectKnownGap } from "@stigmer/test-support/known-gap";
import { TOOL_SERVER, expect, journeySkipReason, test } from "../../fixtures/first-hour";
import { APP_PORT, packKit, runTutorial, type TutorialRun } from "../../helpers/embed-tutorial";
import {
  askForTheTool,
  drainModel,
  expectToolResultInTimeline,
  nonce,
  prepareEmbedding,
  scriptToolCall,
  turnSummary,
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

  test("the tutorial's app signs its user in through the login page, and the next message meets the known gap", async ({ journey, browser }) => {
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

      await test.step("the user's next message: the tool call, held as a known gap until stigmer/stigmer#3470", async () => {
        const value = nonce("embedded");
        await scriptToolCall(target.model, value, "call_first_hour_embedded");
        const composer = app.getByRole("textbox").first();
        await composer.fill(askForTheTool(value));
        await app.getByRole("button", { name: "Send message" }).click();

        const refusal = app.getByText(new RegExp(`needs ${LOGIN_KEY}`)).first();
        const called = turnSummary(app);
        await expect(refusal.or(called).first(), "the message either calls the tool or is refused").toBeVisible({ timeout: 120_000 });
        const refused = await refusal.isVisible();

        await expectKnownGap(
          {
            issue: "stigmer/stigmer#3470",
            today: {
              says: `the message is refused: the run reads only the embedding settings' vaults, never the login the user's sign-in saved, so it lacks ${LOGIN_KEY}`,
              holds: () => refused,
            },
          },
          async () => {
            await expectToolResultInTimeline(app, value, refused ? 5_000 : 120_000);
          },
        );
        await drainModel(target.model, !refused);
      });
    } finally {
      await appContext.close();
    }
    journey.reach("embedded-tool-call");
  });
});
