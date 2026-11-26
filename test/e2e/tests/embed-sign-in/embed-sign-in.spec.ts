// A sign-in to a tool server, from a chat embedded in an app on its own
// address (stigmer/stigmer#3467): the embedding tutorial's app
// (docs/getting-started/embed-agent.mdx), run from its page on the
// open-source server that signs its callers in, with the mock model.
//
// What it proves: a person signed in to the app, on an address that is not
// the console's (Vite on :5173, the console on :3000), signs in to a tool
// server the agent uses, through a login page that cuts the sign-in window
// off from the app (`Cross-Origin-Opener-Policy: same-origin`, as Sentry's
// login page does), and the chat finishes it: the login page returns to the
// console's callback page, which hands the answer to Stigmer and never says
// "Connected", and the app collects it under the person's own session and
// says "Signed in".
//
// It ends there: an app user's run reads only the vaults on the
// organization's embedding settings, never the app user's own My vault
// where the sign-in saved the login, so the agent cannot call the tool with
// it yet (stigmer/stigmer#3470).
//
// The tool server is added as the console adds one ("Add MCP server", a
// plugin of that one server, whose install finds it signs in), and the
// tutorial's Agent lists the plugin. The earlier pages' state is made as
// the embedding tutorial makes it (`prepareReader`).
//
// Stack shape: STIGMER_E2E_OIDC=1 and STIGMER_E2E_MOCK_LLM=1 (`make
// test-e2e-console-login`): the OIDC stack starts the OAuth MCP fixture
// with its login page's opener policy, and the server's OAuth redirect is
// the console's callback page.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "@playwright/test";
import { create } from "@bufbuild/protobuf";
import { createNodeClient } from "@stigmer/client/node";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OIDC_STACK } from "../../fixtures/oidc";
import { getOAuthMcpFixture } from "../../fixtures/oauth-mcp";
import { getMockControlUrl } from "../../helpers/mock-llm-control";
import { APP_PORT, ownerBearer, packKit, prepareReader, runTutorial, type TutorialRun } from "../../helpers/embed-tutorial";

const API_PORT = process.env.STIGMER_E2E_API_PORT ?? "7234";
const API_URL = `http://localhost:${API_PORT}`;
const mockUrl = getMockControlUrl();
const oauthMcp = getOAuthMcpFixture();

/** The tool server's name, which is its plugin's too. */
const SERVER = "app-tools";


test.describe("a chat in an app on its own address signs in to the app's tool server", () => {
  test.skip(
    !OIDC_STACK || mockUrl === null || oauthMcp === null,
    "needs the OIDC stack with the mock model and the OAuth MCP fixture — run `make test-e2e-console-login`",
  );
  test.describe.configure({ mode: "serial", timeout: 900_000 });

  let tutorial: TutorialRun | null = null;
  let folder = "";

  test.afterAll(() => {
    tutorial?.stop();
    if (folder !== "") rmSync(folder, { recursive: true, force: true });
  });

  test("the login page cuts the window off, and the chat still finishes the sign-in", async ({
    page,
    browser,
  }) => {
    // The earlier pages' state, as the console's owner, with a key of this run's own.
    const reader = await prepareReader(page, API_URL, "report-backend-sign-in");

    // The tool server, added as the console adds one; its install finds it signs in.
    await page.goto("/library/plugins?add=mcp-server");
    const add = page.getByRole("dialog", { name: "Add MCP server" });
    await expect(add).toBeVisible({ timeout: 30_000 });
    await add.getByLabel("Name").fill(SERVER);
    await add.getByLabel("URL").fill(oauthMcp!.mcpUrl);
    await add.getByRole("button", { name: "Add", exact: true }).click();
    await page.waitForURL(new RegExp(`/library/plugins/[^/]+/${SERVER}$`), { timeout: 60_000 });
    await expect(page.getByRole("button", { name: `Sign in to ${SERVER}` })).toBeVisible({ timeout: 30_000 });

    // The tutorial's Agent uses it. The fixture listens on this machine
    // (loopback), which only an agent with a computer may reach; a host's
    // tool server on the internet needs none.
    const bearer = await ownerBearer(page, API_PORT);
    const owner = createNodeClient({ baseUrl: API_URL, getAccessToken: () => bearer });
    const agent = await owner.agent.getByReference({ org: reader.org, slug: "variance-reporter" });
    agent.spec!.plugins = [create(ApiResourceReferenceSchema, { kind: ApiResourceKind.plugin, org: reader.org, slug: SERVER })];
    agent.spec!.computer = Computer.REQUIRED;
    await owner.agent.update(agent, ["spec.plugins", "spec.computer"]);

    // The tutorial's app, as its page writes it, on its own address.
    folder = mkdtempSync(join(tmpdir(), "stigmer-embed-sign-in-"));
    const tarballs = packKit(join(folder, "tarballs"));
    tutorial = await runTutorial(join(folder, "reader"), tarballs, { apiUrl: API_URL, apiKey: reader.apiKey, org: reader.org });

    // The person signed in to the app is asked to sign in to the tool server.
    const app = await browser.newPage();
    await app.goto(`http://localhost:${APP_PORT}`);
    const signIn = app.getByRole("button", { name: `Sign in to ${SERVER}` });
    await expect(signIn).toBeVisible({ timeout: 60_000 });

    // The login page carries Sentry's opener policy: consenting there cuts
    // the window off from the app, so nothing reaches the app but Stigmer.
    const popupOpened = app.context().waitForEvent("page");
    await signIn.click();
    const popup = await popupOpened;
    await popup.getByRole("link", { name: "Allow" }).click({ timeout: 30_000 });

    // The callback page says where the person signed in, never "Connected",
    // and the chat finishes the sign-in itself.
    await expect(app.getByText("Signed in")).toBeVisible({ timeout: 60_000 });
    await expect(app.getByRole("button", { name: `Sign in to ${SERVER}` })).toHaveCount(0);
    if (!popup.isClosed()) {
      await expect(popup.getByRole("heading", { name: /^You're signed in at / })).toBeVisible();
      await expect(popup.getByText("Connected")).toHaveCount(0);
    }
  });
});
