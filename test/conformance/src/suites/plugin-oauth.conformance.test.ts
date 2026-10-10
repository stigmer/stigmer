// Conformance suite for signing in to a plugin's MCP server (Class A).
// Domain: agentic / plugin — the sign-in facet.
//
// A sign-in is never started from a plugin: it starts from an address on the
// vault (suites/vault-sign-in.conformance.test.ts) and fills every HTTP tool
// whose URL is that address. What this facet pins is the join between the
// two: a plugin server the install completed for Sign in
// (plugin-sign-in-probe) is signed in to AT ITS OWN URL, the walk goes from
// that URL's protected-resource document to its login server (OAuth
// authorization server discovery), and the login lands in the caller's My
// vault at exactly the address the entry's Bearer header is filled from:
//
//   - the completed entry names its URL and the variable its login fills;
//   - startSignIn at that URL discovers the login server the URL's document
//     names and asks for a token for that URL alone;
//   - completeSignIn saves the login at that URL in My vault;
//   - a login server that cannot be discovered refuses the sign-in naming
//     the document that failed;
//   - a local program is never offered a sign-in: its keys are secrets by
//     name.
//
// Every network counterparty is suite-owned and loopback: the MCP endpoint
// is the harness's McpToolFixture in its OAuth posture, serving the RFC 9728
// document that names the mock login server
// (test/support/src/oauth-authorization-server.ts). The use of the saved
// login by a run and by a tools listing is the execution class's
// (suites-execution/plugin-tools.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { MockOAuthAuthorizationServer } from "@stigmer/test-support/oauth-authorization-server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { McpToolFixture } from "../harness/mcp-server";
import { uniqueName } from "../support/naming";
import { oneServerPlugin, pushPlugin } from "../support/plugins";
import { myVaultTarget } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const mockAs = new MockOAuthAuthorizationServer();
const endpoint = new McpToolFixture();

// The server's name inside the plugin, and the variable its login fills.
const SERVER = "linear";
const ACCESS_TOKEN = "LINEAR_ACCESS_TOKEN";

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  await mockAs.start();
  await endpoint.start();
});

afterEach(async () => {
  endpoint.requireOAuth(undefined);
  endpoint.resetCaptured();
  mockAs.reset();
  await fixtures.cleanup();
});

afterAll(async () => {
  await endpoint.close();
  await mockAs.close();
  await target?.teardown();
});

// The endpoint's hosted posture: every credential-less request is
// challenged, and its protected-resource document names this test's login
// server (the issuer is fresh after every reset).
function hostedBehindMockLogin(): void {
  endpoint.requireOAuth({
    resourceMetadataUrl: `${new URL(endpoint.url()).origin}/.well-known/oauth-protected-resource${new URL(endpoint.url()).pathname}`,
    authorizationServerOrigin: mockAs.issuer(),
  });
}

// A plugin whose one server is the endpoint, installed and completed for
// Sign in; answers the URL the entry names.
async function installSignInPlugin(org: string): Promise<string> {
  const plugin = await pushPlugin(
    clients,
    fixtures,
    org,
    oneServerPlugin({ name: uniqueName("plg-signin"), serverName: SERVER, server: { url: endpoint.url() } }),
  );
  const entry = plugin.status?.mcpServers[0];
  expect(entry?.signIn?.oauthOnly, "the install completed the server for Sign in").toBe(true);
  expect(entry?.env).toEqual([ACCESS_TOKEN]);
  expect(entry?.transport.case).toBe("http");
  return entry?.transport.case === "http" ? entry.transport.value.url : "";
}

// Reads My vault after a sign-in saved into it, and removes it with the test.
async function myVault(org: string) {
  const mine = await clients.vaultQuery.getMine({ org });
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
  return mine;
}

describe("Plugin sign-in conformance — OAuth authorization server discovery from the server's own URL", () => {
  it("[rpc:VaultCommandController.startSignIn] a sign-in at a completed plugin server's URL walks its document to its login server and asks for a token for that URL alone", async () => {
    hostedBehindMockLogin();
    const { org } = await target.provisionTenancy();
    const address = await installSignInPlugin(org);
    expect(address).toBe(endpoint.url());

    const out = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    expect(out.state).not.toBe("");
    expect(out.providerName, "a discovered login server is named by the address's host").toBe(new URL(address).host);
    expect(mockAs.capturedDiscoveryPaths()).toEqual([
      `/.well-known/oauth-authorization-server${new URL(mockAs.issuer()).pathname}`,
    ]);
    expect(mockAs.capturedDcrRequests()).toHaveLength(1);
    const url = new URL(out.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(mockAs.authorizationEndpoint());
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("resource"), "the token is asked for the plugin server's URL only").toBe(address);
  });

  it("[rpc:VaultCommandController.startSignIn] [rpc:VaultCommandController.completeSignIn] completing it saves the login in My vault at exactly the URL the entry's Bearer header is filled from", async () => {
    hostedBehindMockLogin();
    const { org } = await target.provisionTenancy();
    const address = await installSignInPlugin(org);
    const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    const done = await clients.vaultCommand.completeSignIn({ state: started.state, code: "conformance-auth-code" });

    expect(done.address).toBe(address);
    expect(mockAs.capturedTokenRequests()).toHaveLength(1);
    expect(mockAs.capturedTokenRequests()[0]?.resource).toBe(address);
    const mine = await myVault(org);
    const connection = mine.spec?.connections[address];
    expect(connection?.source).toBe(VaultConnectionSource.sign_in);
    expect(connection?.signIn?.authMethod).toBe("mcp_oauth");
    expect(connection?.token, "a read never shows the token").toBe("");
  });

  it("[rpc:VaultCommandController.startSignIn] refuses when OAuth authorization server discovery fails, naming the document that failed", async () => {
    hostedBehindMockLogin();
    const { org } = await target.provisionTenancy();
    const address = await installSignInPlugin(org);
    mockAs.discoveryStatus = 503;

    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address }),
      Code.FailedPrecondition,
      "startSignIn with failing discovery",
    );
    expect(err.rawMessage).toContain(`nothing can sign in to ${address}: authorization server discovery failed:`);
    expect(err.rawMessage).toContain("returned HTTP 503 (expected 200)");
  });
});

describe("Plugin sign-in conformance — a local program takes no sign-in", () => {
  it("[rpc:PluginCommandController.push] a stdio server is never asked and never completed: the key it reads is a required secret by name", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      oneServerPlugin({
        name: uniqueName("plg-local"),
        serverName: "notes",
        server: { command: "npx", args: ["-y", "notes-mcp"], env: { NOTES_TOKEN: "${NOTES_TOKEN}" } },
      }),
    );
    const entry = plugin.status?.mcpServers[0];
    expect(entry?.transport.case).toBe("stdio");
    expect(entry?.signIn).toBeUndefined();
    expect(entry?.env).toEqual(["NOTES_TOKEN"]);
    expect(plugin.status?.env["NOTES_TOKEN"]).toMatchObject({ isSecret: true, optional: false });
  });
});
