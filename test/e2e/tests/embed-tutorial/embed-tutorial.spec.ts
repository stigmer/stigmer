// KIT-02 end to end: the tutorial "Put the agent in your app"
// (docs/getting-started/embed-agent.mdx), run from its page on the
// open-source server that signs its callers in, with the mock model.
//
// What it proves: a reader who has done the earlier pages (the quickstart's
// Agent, a service account's key) and follows this one gets an app that
// installs the kit with the page's install line, builds and typechecks
// (strict), mints a token for a person signed in to it through its own
// backend, and lets that person attach the ledger, send the page's message
// and see the Agent's report among what the turn made, in `<AgentChat>`.
//
// The page's earlier steps a reader does in the console are done here
// through the API as the console's signed-in owner: the Agent applied from
// the quickstart's file, the service account and its key, and account
// creation turned on in the embedding settings with the member role.
//
// Stack shape: STIGMER_E2E_OIDC=1 and STIGMER_E2E_MOCK_LLM=1 (`make
// test-e2e-console-login`, which runs this project beside console-login).
// The model is scripted: the report written into the outputs folder, then a
// closing line; the conversation's title is answered out of band.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
import { create } from "@bufbuild/protobuf";
import { createNodeClient } from "@stigmer/client/node";
import { parseManifest } from "@stigmer/client";
import { CreateServiceAccountInputSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/io_pb";
import { CreateServiceAccountKeyInputSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";
import {
  ListMyOrganizationsInputSchema,
  UpdateOrganizationEmbeddingInputSchema,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { OIDC_STACK } from "../../fixtures/oidc";
import { MockControl, getMockControlUrl } from "../../helpers/approval";
import { anthropicText, anthropicToolUses } from "../../fixtures/mock-llm";
import { APP_PORT, packKit, quickstartFile, runTutorial, type TutorialRun } from "../../helpers/embed-tutorial";

const API_PORT = process.env.STIGMER_E2E_API_PORT ?? "7234";
const API_URL = `http://localhost:${API_PORT}`;
const mockUrl = getMockControlUrl();
const REPORT = "variance-report.md";

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

test.describe("KIT-02 the embed tutorial, run from its page", () => {
  test.skip(!OIDC_STACK || mockUrl === null, "needs the OIDC stack with the mock model — run `make test-e2e-console-login`");
  test.describe.configure({ mode: "serial", timeout: 900_000 });

  let tutorial: TutorialRun | null = null;
  let folder = "";

  test.afterAll(() => {
    tutorial?.stop();
    if (folder !== "") rmSync(folder, { recursive: true, force: true });
  });

  test("a person signed in to the app attaches the ledger in its chat and gets the report", async ({ page, browser }) => {
    // The earlier pages' state, as the console's owner.
    const bearer = await ownerBearer(page);
    const owner = createNodeClient({ baseUrl: API_URL, getAccessToken: () => bearer });
    const [org] = (await owner.organization.listMine(create(ListMyOrganizationsInputSchema, {}))).entries;
    const orgSlug = org?.metadata?.slug ?? "";
    expect(orgSlug, "the server made its one organization").not.toBe("");
    for (const document of parseManifest(quickstartFile("variance-reporter.yaml").replace("metadata:\n", `metadata:\n  org: ${orgSlug}\n`))) {
      await owner.manifest.apply(document);
    }
    const account = await owner.identityAccount.createServiceAccount(
      create(CreateServiceAccountInputSchema, { org: orgSlug, name: "report-backend", role: IamRole.admin }),
    );
    const key = await owner.apiKey.createForServiceAccount(
      create(CreateServiceAccountKeyInputSchema, { serviceAccountId: account.metadata?.id ?? "", name: "report-backend", neverExpires: true }),
    );
    await owner.organization.updateEmbedding(
      create(UpdateOrganizationEmbeddingInputSchema, {
        orgId: orgSlug,
        embedding: { createAccountsOnSignIn: true, signInRole: IamRole.member },
      }),
    );

    // The page, as written.
    folder = mkdtempSync(join(tmpdir(), "stigmer-embed-tutorial-"));
    const tarballs = packKit(join(folder, "tarballs"));
    tutorial = await runTutorial(join(folder, "reader"), tarballs, { apiUrl: API_URL, apiKey: key.spec?.keyHash ?? "", org: orgSlug });

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

    // The person signed in to the app: attach, send, receive.
    const app = await browser.newPage();
    await app.goto(`http://localhost:${APP_PORT}`);
    const message = app.getByRole("textbox").first();
    await expect(message).toBeVisible({ timeout: 60_000 });
    await app.locator('input[type="file"]').first().setInputFiles({
      name: "ledger.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(quickstartFile("ledger.csv")),
    });
    await message.fill("Review this quarter's ledger.");
    await message.press("Enter");
    const outcome = app.getByRole("region", { name: "What this turn produced" });
    await expect(outcome).toBeVisible({ timeout: 120_000 });
    await expect(outcome).toContainText(REPORT);
  });
});
