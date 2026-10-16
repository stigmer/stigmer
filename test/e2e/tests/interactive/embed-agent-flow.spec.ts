import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import type { Stigmer } from "@stigmer/client";
import { test, expect } from "../../fixtures";
import { ensureDefaultOrg } from "../../fixtures/seed-helpers";

/**
 * One-line script embed against the real stack: a genuinely cross-origin
 * host page (127.0.0.1:<random> vs the app's localhost:3000) pastes the
 * exact snippet the Share dialog emits, and the loader must upgrade
 * `<stigmer-agent>` into an iframe onto the hosted chat page.
 *
 * Scope note: the guest experience inside the frame is cloud-only —
 * `mintGuestToken` has no OSS implementation, and the guest token provider
 * deliberately fails fast, so on the OSS stack the framed page renders
 * its error state rather than the chat. These tests therefore prove the
 * loader mechanics (element upgrade, app-origin derivation, cross-origin
 * frame boot, attribute passing, stays-visible-unless-refused); the
 * allowed-origins enforcement contract is proven end to end by the cloud
 * integration suite (`TestGuestToken_EmbedOriginEnforcement`).
 */

const APP_URL = process.env.STIGMER_E2E_BASE_URL ?? "http://localhost:3000";

/** Serves a host page containing the pasted embed snippet. */
function hostPageHtml(attributes: string): string {
  return `<!doctype html>
<html>
  <head><title>Embed host page</title></head>
  <body>
    <h1>Acme docs</h1>
    <script src="${APP_URL}/embed.js" async></script>
    <stigmer-agent ${attributes}></stigmer-agent>
  </body>
</html>`;
}

let server: Server;
let hostOrigin: string;
let hostPageAttributes = "";

// A share is a web Channel: apply upserts the
// share by (org, slug) — creating it on first use, as the CLI's
// apply does. An embed serves anonymous
// visitors, so the share says public: an omitted audience means the
// organization's members, which an embed never serves.
/** Applies an enabled public share of the agent and answers its id, which the embed names. */
async function enableSharing(
  client: Stigmer,
  agent: { org: string; slug: string },
): Promise<string> {
  const share = await client.channel.apply({
    org: agent.org,
    slug: agent.slug,
    name: agent.slug,
    agentRef: { org: agent.org, slug: agent.slug },
    enabled: true,
    web: { audience: ChannelAudience.public },
  });
  return share.metadata!.id;
}

test.describe("Embed agent flow", () => {
  test.beforeAll(async ({ stigmerClient }) => {
    await ensureDefaultOrg(stigmerClient);

    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(hostPageHtml(hostPageAttributes));
    });
    await new Promise<void>((resolve) => {
      // 127.0.0.1 is deliberate: a different origin than the app's
      // localhost:3000, so the iframe boundary is genuinely cross-origin.
      server.listen(0, "127.0.0.1", resolve);
    });
    const { address, port } = server.address() as AddressInfo;
    hostOrigin = `http://${address}:${port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  test("the pasted snippet boots the widget cross-origin", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    const channelId = await enableSharing(stigmerClient, testAgent);

    hostPageAttributes = `channel="${channelId}"`;
    await page.goto(`${hostOrigin}/`);

    // The loader upgraded the element into an iframe pointed at the hosted
    // chat page, deriving the app origin from its own script URL.
    const embedFrame = page.locator("stigmer-agent iframe");
    await expect(embedFrame).toHaveAttribute(
      "src",
      `${APP_URL}/chat/${channelId}`,
      { timeout: 15_000 },
    );

    // The framed chat page booted and rendered. Against cloud that is the
    // shared profile (agent name); against OSS the guest token provider
    // fails fast on the unimplemented mintGuestToken, so the page shows
    // its error state instead — either way the app is alive in the frame.
    await expect(
      page
        .frameLocator("stigmer-agent iframe")
        .getByText(new RegExp(`${testAgent.slug}|Something went wrong`)),
    ).toBeVisible({ timeout: 20_000 });

    // The widget stays visible: only an explicit origin refusal hides it.
    await expect(page.locator("stigmer-agent")).toBeVisible();
  });

  test("a page carrying the older share attribute still loads the chat", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    const channelId = await enableSharing(stigmerClient, testAgent);

    hostPageAttributes = `share="${channelId}"`;
    await page.goto(`${hostOrigin}/`);

    await expect(page.locator("stigmer-agent iframe")).toHaveAttribute(
      "src",
      `${APP_URL}/chat/${channelId}`,
      { timeout: 15_000 },
    );
  });

  test("theme and sizing attributes flow into the frame", async ({
    page,
    testAgent,
    stigmerClient,
  }) => {
    const channelId = await enableSharing(stigmerClient, testAgent);

    hostPageAttributes = `channel="${channelId}" theme="dark" width="320" height="480"`;
    await page.goto(`${hostOrigin}/`);

    const embedFrame = page.locator("stigmer-agent iframe");
    await expect(embedFrame).toHaveAttribute(
      "src",
      `${APP_URL}/chat/${channelId}?theme=dark`,
      { timeout: 15_000 },
    );

    const box = await page.locator("stigmer-agent").boundingBox();
    expect(box?.width).toBe(320);
    expect(box?.height).toBe(480);
  });
});
