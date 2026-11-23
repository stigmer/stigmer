// "Make the chat your own" end to end: the embedding tutorial
// (docs/getting-started/embed-agent.mdx), then the page that makes its chat
// the reader's own (docs/getting-started/make-the-chat-your-own.mdx), run
// from their pages in one folder on the open-source server that signs its
// callers in, with the mock model.
//
// What it proves: a reader who follows both pages gets an app that builds
// and typechecks (strict) with every file the second page writes, and in
// which a person signed in to it sees each way a host shapes the chat
// working as the page says, so a change to the kit or the page that breaks
// a host goes red here, naming the level:
//   - tokens: the provider's scope wears the brand, light and dark, and the
//     chat's text stays readable on it;
//   - the app's own tool and its card: the agent's call of `open_account`
//     draws the app's card inside the kit's row, which keeps its own
//     "Waiting for the app" line; the person answers by keyboard and the
//     turn carries on with the answer;
//   - the swapped part: the person's message is drawn in the app's bubble;
//   - the conversation hook: the app's header, outside the chat, says what
//     the agent is doing in the kit's own words;
//   - the message action: "Add to month-end notes" sits beside Copy on the
//     final answer, is reached by keyboard and adds the answer to the notes.
//
// Stack shape as KIT-02 (embed-tutorial.spec.ts), in the same project and
// invocation (`make test-e2e-console-login`). The model is scripted: the
// call of the app's tool, then a closing answer once the app answered.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Locator, type Page } from "@playwright/test";
import { OIDC_STACK } from "../../fixtures/oidc";
import { MockControl, getMockControlUrl, messageThread, toolCallRow } from "../../helpers/approval";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import {
  APP_PORT,
  EMBED_PAGE,
  MAKE_IT_YOURS_PAGE,
  contrastOf,
  packKit,
  prepareReader,
  quickstartFile,
  runTutorial,
  type TutorialRun,
} from "../../helpers/embed-tutorial";

const API_PORT = process.env.STIGMER_E2E_API_PORT ?? "7234";
const API_URL = `http://localhost:${API_PORT}`;
const mockUrl = getMockControlUrl();

/** The page's brand, as `src/brand.css` sets it. */
const BRAND = { light: "oklch(0.5 0.13 165)", dark: "oklch(0.78 0.13 165)" };
const MESSAGE = "Review this quarter's ledger and show me any account that looks off.";
const ANSWER = "Travel is 18% over budget, and you confirmed the figure looks right.";

/** The brand's primary as the provider's scope resolves it. */
function primaryOf(app: Page): Promise<string> {
  return app.locator("[data-stgm-root]").first().evaluate((scope) => getComputedStyle(scope).getPropertyValue("--stgm-primary").trim());
}

/** Presses Tab until `target` has focus, as a keyboard user reaches it; fails after `limit` presses. */
async function tabTo(app: Page, target: Locator, limit = 80): Promise<void> {
  for (let press = 0; press < limit; press++) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await app.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached ${String(target)}`);
}

test.describe("make the chat your own, run from its page on the embedding tutorial's app", () => {
  test.skip(!OIDC_STACK || mockUrl === null, "needs the OIDC stack with the mock model — run `make test-e2e-console-login`");
  test.describe.configure({ mode: "serial", timeout: 900_000 });

  let tutorial: TutorialRun | null = null;
  let folder = "";

  test.afterAll(() => {
    tutorial?.stop();
    if (folder !== "") rmSync(folder, { recursive: true, force: true });
  });

  test("the brand, the app's card and tool, the bubble, the header line and the action each work as the page says", async ({ page, browser }, testInfo) => {
    // The earlier pages' state, as the console's owner, then both pages as written.
    const reader = await prepareReader(page, API_URL, "make-the-chat-your-own");
    folder = mkdtempSync(join(tmpdir(), "stigmer-make-the-chat-your-own-"));
    const tarballs = packKit(join(folder, "tarballs"));
    tutorial = await runTutorial(join(folder, "reader"), tarballs, { apiUrl: API_URL, apiKey: reader.apiKey, org: reader.org }, [EMBED_PAGE, MAKE_IT_YOURS_PAGE]);

    // The model: the app's tool called for the flagged account, then the answer.
    const control = new MockControl(mockUrl!);
    await control.reset();
    await control.enqueue(
      anthropicToolUses([{ toolCallId: "toolu_open_account", toolName: "open_account", toolInput: { account: "Travel", variance: "+18%" } }]),
    );
    await control.enqueue(anthropicText(ANSWER));

    const context = await browser.newContext({ colorScheme: "light" });
    const app = await context.newPage();
    await app.goto(`http://localhost:${APP_PORT}`);
    const message = app.getByRole("textbox").first();
    await expect(message).toBeVisible({ timeout: 60_000 });

    // Tokens: the scope wears the brand.
    expect(await primaryOf(app), "tokens: the provider's scope wears the brand").toBe(BRAND.light);
    const header = app.getByRole("banner");
    await expect(header, "the conversation hook: idle before the first message").toContainText("Ready");

    await app.locator('input[type="file"]').first().setInputFiles({
      name: "ledger.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(quickstartFile("ledger.csv")),
    });
    await message.fill(MESSAGE);
    await message.press("Enter");

    // The swapped part: the person's message in the app's own bubble, with the file it carried.
    const bubble = app.locator(".person-bubble");
    await expect(bubble, "the swapped part: the person's message in the app's bubble").toContainText(MESSAGE, { timeout: 60_000 });
    await expect(bubble, "the bubble draws what the page gives it: the files the message carried").toContainText("1 file attached");

    // The app's tool and its card: the card inside the kit's row, which keeps its own line.
    const thread = messageThread(app);
    const card = thread.getByRole("region", { name: "Account Travel" });
    await expect(card, "the app's card: drawn for the agent's call of open_account").toBeVisible({ timeout: 120_000 });
    await expect(card).toContainText("+18% against budget");
    const row = toolCallRow(thread).filter({ has: card });
    await expect(row, "the kit's row keeps its own line around the app's card").toContainText("Waiting for the app");
    await expect(header, "the conversation hook: the header says what the agent waits on").toContainText("Waiting for the app");
    await app.screenshot({ path: testInfo.outputPath("waiting-light.png"), fullPage: true });

    // The person answers by keyboard, and the turn carries on with the answer.
    const looksRight = card.getByRole("button", { name: "Looks right" });
    await tabTo(app, looksRight);
    await app.keyboard.press("Enter");
    await expect(thread.getByText(ANSWER), "the agent carries on once the app answered").toBeVisible({ timeout: 120_000 });
    await expect(card, "the app's card reads the answered call").toContainText("Checked: Looks right");
    await expect(header, "the conversation hook: idle once the turn ended").toContainText("Ready");

    // The message action: beside Copy on the final answer, reached by keyboard, adding to the notes.
    const add = thread.getByRole("button", { name: "Add to month-end notes" });
    await expect(add, "the message action: on the final answer").toHaveCount(1);
    await tabTo(app, add);
    await app.keyboard.press("Enter");
    await expect(app.getByRole("complementary", { name: "Month-end notes" }), "the message action adds the answer to the notes").toContainText(ANSWER);

    // The default's quality holds on the brand: the chat's text and the bubble stay readable.
    expect(await contrastOf(app, ANSWER), "the answer's contrast on the brand, light").toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(app, MESSAGE), "the bubble's contrast, light").toBeGreaterThanOrEqual(4.5);
    await app.screenshot({ path: testInfo.outputPath("answered-light.png"), fullPage: true });

    // Dark, from the person's computer (`colorMode="system"`): the brand's dark values.
    await app.emulateMedia({ colorScheme: "dark" });
    await expect.poll(() => primaryOf(app), { message: "tokens: the brand's dark value when the computer is dark" }).toBe(BRAND.dark);
    expect(await contrastOf(app, ANSWER), "the answer's contrast on the brand, dark").toBeGreaterThanOrEqual(4.5);
    expect(await contrastOf(app, MESSAGE), "the bubble's contrast, dark").toBeGreaterThanOrEqual(4.5);
    await app.screenshot({ path: testInfo.outputPath("answered-dark.png"), fullPage: true });
    await context.close();
  });
});
