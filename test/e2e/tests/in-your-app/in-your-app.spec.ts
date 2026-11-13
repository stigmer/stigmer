// CON-10 end to end: a scratch app built from exactly what the agent page's
// "In your app" tab hands over shows the agent's chat, and the console says
// when the app's first user arrived.
//
// On the open-source server that signs its callers in, with the mock model:
// the console's owner opens the variance reporter's In your app tab on a
// fresh organization (no admin service account, account creation off, no
// app user), picks Node, makes the service account there (its key read from
// the page), turns account creation on there, and copies the route and the
// chat from the page's own code blocks. A Vite app is built from that text
// alone (test/e2e/helpers/embed-tutorial.ts `runHandedOverApp`), its route
// started with the key and STIGMER_DEV_USER. A person in the app attaches
// the ledger, sends, and sees the report among what the turn made. Back in
// the console, the tab's last row names that person, and the dashboard's
// card marks "Put it in your app" done.
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
import { APP_PORT, packKit, quickstartFile, runHandedOverApp, type TutorialRun } from "../../helpers/embed-tutorial";

const API_PORT = process.env.STIGMER_E2E_API_PORT ?? "7234";
const API_URL = `http://localhost:${API_PORT}`;
const mockUrl = getMockControlUrl();
const REPORT = "variance-report.md";
/** The person the handed-over route signs in until its builder wires their own sign-in. */
const DEV_USER = "dana@app.example";

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

/** The tab's row whose title is `title`. */
function row(page: Page, title: string) {
  return page.getByRole("listitem").filter({ has: page.getByText(title, { exact: true }) });
}

test.describe("CON-10 a scratch app built from exactly what the In your app tab hands over shows the agent's chat, and the console says its first user arrived", () => {
  test.skip(!OIDC_STACK || mockUrl === null, "needs the OIDC stack with the mock model — run `make test-e2e-console-login`");
  test.describe.configure({ mode: "serial", timeout: 900_000 });

  let app: TutorialRun | null = null;
  let folder = "";

  test.afterAll(() => {
    app?.stop();
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

    // Node; the service account made in place, its key read once from the page.
    await page.getByRole("radio", { name: "Node" }).click();
    await account.getByRole("button", { name: "Make it" }).click();
    const apiKey = ((await account.getByRole("alert").locator("code").textContent()) ?? "").trim();
    expect(apiKey, "the key is shown once").not.toBe("");
    await embedding.getByRole("switch").click();
    await expect(embedding).toContainText("On for this organization", { timeout: 15_000 });

    // Exactly what the page hands over.
    const route = (await page.getByRole("region", { name: "server.ts" }).textContent()) ?? "";
    const chat = (await page.getByRole("region", { name: "StigmerAgentChat.tsx" }).textContent()) ?? "";
    expect(route).toContain(`const ORG = "${orgSlug}";`);
    expect(chat).toContain(`agent={"${orgSlug}/variance-reporter"}`);

    folder = mkdtempSync(join(tmpdir(), "stigmer-in-your-app-"));
    app = await runHandedOverApp(folder, packKit(join(folder, "tarballs")), { route, chat }, { apiKey, devUser: DEV_USER });

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
    await expect(first).toContainText(`${DEV_USER} signed in from your app`, { timeout: 30_000 });
    await page.goto("/");
    const step = page.getByRole("listitem").filter({ hasText: "Put it in your app" });
    await expect(step).toContainText(`${DEV_USER} signed in from your app`, { timeout: 30_000 });
    await expect(step).toContainText("(done)");
  });
});
