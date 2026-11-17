// CON-10 end to end: a scratch app built from exactly what the agent page's
// "In your app" tab hands over shows the agent's chat, and the console says
// when the app's first user arrived.
//
// On the open-source server that signs its callers in, with the mock model:
// the console's owner opens the variance reporter's In your app tab on a
// fresh organization (no admin service account, account creation off, no
// app user), picks Node, makes the service account there (its key read from
// the settings file the page hands over while the key is on screen), turns
// account creation on there, and copies the route, the chat and the page
// that tries it from the page's own code blocks. A Vite app is built from
// that text alone (test/e2e/helpers/embed-tutorial.ts `runHandedOverApp`),
// its route started with the run line its own comment names, which reads
// the handed-over .env (the key, and STIGMER_DEV_USER set to the person the
// app signs in). A person in the app
// attaches the ledger, sends, and sees the report among what the turn made.
// Back in the console, the tab's last row names that person, and the
// dashboard's card marks "Put it in your app" done.
//
// Then Next.js: the owner picks it, makes another service account, and
// copies the one install line and every block the tab hands over (the
// route, the chat, the page, and the `.env.local` that holds the key and
// the development user) at the paths the tab names them by. A stock
// create-next-app is built from exactly that (`runHandedOverNextApp`), with
// nothing about Stigmer in its environment. Opened at /agent in a browser
// whose system is dark, on the template's own near-black page, the chat's
// first-message heading and the agent's answer read at 4.5:1 or better
// against what is painted behind them.
//
// The agent is applied over the API, as the embedding tutorial applies it:
// the console's own way of making one is the first question's, proven
// elsewhere. Stack shape: STIGMER_E2E_OIDC=1 and STIGMER_E2E_MOCK_LLM=1
// (`make test-e2e-console-login`). Its project runs after console-login
// and before embed-tutorial (playwright.config.ts): the tutorial turns
// account creation on and signs a person in through its own backend, which
// would leave nothing here to wait for.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { create } from "@bufbuild/protobuf";
import { createNodeClient } from "@stigmer/client/node";
import { parseManifest } from "@stigmer/client";
import { ListMyOrganizationsInputSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { OIDC_STACK } from "../../fixtures/oidc";
import { MockControl, getMockControlUrl } from "../../helpers/approval";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import {
  APP_PORT,
  NEXT_APP_PORT,
  contrastOf,
  packKit,
  quickstartFile,
  runHandedOverApp,
  runHandedOverNextApp,
  type TutorialRun,
} from "../../helpers/embed-tutorial";

const API_PORT = process.env.STIGMER_E2E_API_PORT ?? "7234";
const API_URL = `http://localhost:${API_PORT}`;
const mockUrl = getMockControlUrl();
const REPORT = "variance-report.md";
/** The person the handed-over route signs in until its builder wires their own sign-in. */
const DEV_USER = "dana@app.example";
/** How the console names that person: the server names an account made from an email alone by its local part. */
const APP_USER_NAME = "dana";

/** Signs in to the console as the issuer's person and returns the bearer its RPCs carry. */
async function ownerBearer(page: Page): Promise<string> {
  let bearer: string | undefined;
  page.on("request", (request) => {
    const authorization = request.headers()["authorization"];
    if (new URL(request.url()).port === API_PORT && authorization?.startsWith("Bearer ")) bearer = authorization.slice(7);
  });
  await page.goto("/");
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => bearer, { timeout: 15_000 }).toBeDefined();
  return bearer!;
}

/** The agent's answer in the Next.js app. */
const NEXT_ANSWER = "Fourteen invoices were a cent off.";

/** The key in a settings file the tab handed over. */
function keyIn(settings: string): string {
  return /^STIGMER_API_KEY=(.*)$/m.exec(settings)?.[1]?.trim() ?? "";
}

/** The tab's row whose title is `title` (a done row's title also says so to a screen reader). */
function row(page: Page, title: string) {
  return page.getByRole("listitem").filter({ hasText: title });
}

test.describe("CON-10 a scratch app built from exactly what the In your app tab hands over shows the agent's chat, and the console says its first user arrived", () => {
  test.skip(!OIDC_STACK || mockUrl === null, "needs the OIDC stack with the mock model — run `make test-e2e-console-login`");
  test.describe.configure({ mode: "serial", timeout: 900_000 });

  let app: TutorialRun | null = null;
  let nextApp: TutorialRun | null = null;
  let folder = "";

  test.afterAll(() => {
    app?.stop();
    nextApp?.stop();
    if (folder !== "") rmSync(folder, { recursive: true, force: true });
  });

  test("the owner takes the route and the chat from the tab; a person in the app gets the report; the tab and the card tick", async ({ page, browser }) => {
    const bearer = await ownerBearer(page);
    const owner = createNodeClient({ baseUrl: API_URL, getAccessToken: () => bearer });
    const [org] = (await owner.organization.listMine(create(ListMyOrganizationsInputSchema, {}))).entries;
    const orgSlug = org?.metadata?.slug ?? "";
    expect(orgSlug, "the server made its one organization").not.toBe("");
    for (const document of parseManifest(quickstartFile("variance-reporter.yaml").replace("metadata:\n", `metadata:\n  org: ${orgSlug}\n`))) {
      await owner.manifest.apply(document);
    }

    // The tab, on a fresh organization: everything still to do.
    await page.goto(`/library/agents/${orgSlug}/variance-reporter?tab=in-app`);
    await expect(page.getByRole("heading", { name: /^Put .+ in your app$/ })).toBeVisible({ timeout: 30_000 });
    const first = row(page, "Your first user from your app");
    await expect(first).toContainText("Waiting for the first person your app signs in", { timeout: 30_000 });
    const account = row(page, "A service account for your backend");
    const embedding = row(page, "Your users get accounts the first time your app signs them in");
    await expect(account.getByRole("button", { name: "Make it" })).toBeVisible();
    await expect(embedding.getByRole("switch")).toHaveAttribute("aria-checked", "false");

    // Node; the service account made in place, its key read once from the
    // settings file the page hands over while the key is on screen.
    await page.getByRole("radio", { name: "Node" }).click();
    await account.getByRole("button", { name: "Make it" }).click();
    const settings = account.getByRole("alert").getByRole("region", { name: ".env" });
    await expect(settings).toBeVisible({ timeout: 15_000 });
    const settingsFile = (await settings.textContent()) ?? "";
    const apiKey = keyIn(settingsFile);
    expect(apiKey, "the key is shown once").not.toBe("");
    expect(apiKey).not.toContain("<");
    await embedding.getByRole("switch").click();
    await expect(embedding).toContainText("On for this organization", { timeout: 15_000 });

    // Exactly what the page hands over.
    const route = (await page.getByRole("region", { name: "server.ts" }).textContent()) ?? "";
    const chat = (await page.getByRole("region", { name: "src/StigmerAgentChat.tsx" }).textContent()) ?? "";
    const tryIt = (await page.getByRole("region", { name: "src/App.tsx" }).textContent()) ?? "";
    expect(route).toContain(`const ORG = "${orgSlug}";`);
    expect(route).toContain("Run it with: npx tsx --env-file=.env server.ts");
    expect(chat).toContain(`agent={"${orgSlug}/variance-reporter"}`);

    folder = mkdtempSync(join(tmpdir(), "stigmer-in-your-app-"));
    app = await runHandedOverApp(folder, packKit(join(folder, "tarballs")), { route, chat, page: tryIt, settings: settingsFile }, { devUser: DEV_USER });

    // The model: the report into the outputs folder, then a closing line.
    const control = new MockControl(mockUrl!);
    await control.reset();
    await control.enqueue(
      anthropicToolUses([
        {
          toolCallId: "toolu_report",
          toolName: "write_file",
          toolInput: { file_path: `/.stigmer/outputs/${REPORT}`, content: "# Q3 variance report\n\nMarketing ran over budget.\n" },
        },
      ]),
    );
    await control.enqueue(anthropicText("The report is saved."));

    // A person in the builder's app: attach, send, receive.
    const builderApp = await browser.newPage();
    await builderApp.goto(`http://localhost:${APP_PORT}`);
    const message = builderApp.getByRole("textbox").first();
    await expect(message).toBeVisible({ timeout: 60_000 });
    await builderApp.locator('input[type="file"]').first().setInputFiles({
      name: "ledger.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(quickstartFile("ledger.csv")),
    });
    await message.fill("Review this quarter's ledger.");
    await message.press("Enter");
    const outcome = builderApp.getByRole("region", { name: "What this turn produced" });
    await expect(outcome).toBeVisible({ timeout: 120_000 });
    await expect(outcome).toContainText(REPORT);

    // Back in the console: the tab's last row ticks by itself, and so does the card.
    await expect(first).toContainText(`${APP_USER_NAME} signed in from your app`, { timeout: 30_000 });
    await page.goto("/dashboard");
    const card = page.getByRole("region", { name: "From first agent to your users" });
    const step = card.getByRole("listitem").filter({ hasText: "Put it in your app" });
    await expect(step).toContainText(`${APP_USER_NAME} signed in from your app`, { timeout: 30_000 });
    await expect(step).toContainText("(done)");
  });

  test("a stock Next.js app built from exactly what the tab hands over shows the chat, readable on the template's dark page", async ({ page, browser }) => {
    const bearer = await ownerBearer(page);
    const owner = createNodeClient({ baseUrl: API_URL, getAccessToken: () => bearer });
    const [org] = (await owner.organization.listMine(create(ListMyOrganizationsInputSchema, {}))).entries;
    const slug = org?.metadata?.slug ?? "";

    // Next.js; another service account, its settings copied while its key is on screen.
    await page.goto(`/library/agents/${slug}/variance-reporter?tab=in-app`);
    await page.getByRole("radio", { name: "Next.js" }).click();
    const account = row(page, "A service account for your backend");
    await account.getByRole("button", { name: /^Make (it|another)$/ }).click();
    const settingsBlock = account.getByRole("alert").getByRole("region", { name: ".env.local" });
    await expect(settingsBlock).toBeVisible({ timeout: 15_000 });
    const settings = (await settingsBlock.textContent()) ?? "";
    expect(settings).toMatch(/^STIGMER_API_KEY=[^<\s]+\nSTIGMER_DEV_USER=[^<\s]+@[^<\s]+\n$/);

    // One install line, and every file under the path the tab names.
    const install = ((await row(page, "Add a token route to your backend").getByRole("region", { name: "Install, once" }).textContent()) ?? "").trim();
    const chatRow = row(page, "Show the chat in your app");
    await expect(chatRow.getByRole("region", { name: "Install" })).toHaveCount(0);
    await expect(chatRow).toContainText("Start your app and open /agent. To put the chat elsewhere, give it a box with a height.");
    const files: Record<string, string> = { ".env.local": settings };
    for (const path of ["app/api/stigmer-token/route.ts", "components/StigmerAgentChat.tsx", "app/agent/page.tsx"]) {
      files[path] = (await page.getByRole("region", { name: path }).textContent()) ?? "";
      expect(files[path], path).not.toBe("");
    }
    expect(files["components/StigmerAgentChat.tsx"]).toContain('colorMode="system"');

    nextApp = await runHandedOverNextApp(folder, packKit(join(folder, "next-tarballs")), install, files);

    const control = new MockControl(mockUrl!);
    await control.reset();
    await control.enqueue(anthropicText(NEXT_ANSWER));

    // A person on the app's page, on a computer whose system is dark.
    const dark = await browser.newContext({ colorScheme: "dark" });
    try {
      const chat = await dark.newPage();
      await chat.goto(`http://localhost:${NEXT_APP_PORT}/agent`);
      const message = chat.getByRole("textbox").first();
      await expect(message).toBeVisible({ timeout: 60_000 });
      // The template's own page is near-black under the chat.
      expect(await chat.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(10, 10, 10)");
      expect(await contrastOf(chat, "What would you like to work on?")).toBeGreaterThanOrEqual(4.5);

      await message.fill("Audit last month's invoices.");
      await message.press("Enter");
      await expect(chat.getByText(NEXT_ANSWER)).toBeVisible({ timeout: 120_000 });
      expect(await contrastOf(chat, NEXT_ANSWER)).toBeGreaterThanOrEqual(4.5);
    } finally {
      await dark.close();
    }
  });
});
