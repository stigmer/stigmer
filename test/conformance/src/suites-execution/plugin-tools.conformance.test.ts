// Conformance suite for listing a plugin server's tools (Class B).
// Domain: agentic / plugin — the tools facet, engine-backed.
//
// PluginCommandController.listTools lists the tools one of a plugin's MCP
// servers offers now, as the caller, and stores nothing. The listing runs on
// a runner (the connect workflow) against the McpToolFixture, so this facet
// is the execution class's. The contract pinned here:
//
//   - the answer is the server's own tool list, each tool with `destructive`
//     true exactly when its MCP annotation says `destructiveHint: true` (the
//     mark the approval default asks before), and a listing asks no model;
//   - a listing stores nothing: the plugin, its digest, its audit and its
//     version history read the same before and after;
//   - the request's own rules: an empty plugin id, server or organization is
//     InvalidArgument; an unknown plugin, or a server the plugin does not
//     carry, is NotFound;
//   - a key the server reads is planned over the caller's My vault before
//     anything starts: a required key My vault lacks is FailedPrecondition
//     naming the server and the key, and once My vault holds it the runner
//     fetches it and sends it in the header the server templates;
//   - a sign-in at an address fills every plugin server at that address
//     (a server the install completed from its OAuth challenge) and none at
//     another, which is refused naming its server and its login key;
//   - an expired sign-in is renewed before the listing, for the address it
//     was made at; a renewal that fails, or one with no refresh token, is
//     refused asking to sign in again;
//   - an unreachable server is FailedPrecondition with the reachability
//     guidance.
//
// Out of scope: the install-time probe that completes a URL-only server
// (suites/plugin-sign-in-probe.conformance.test.ts), the sign-in lane itself
// (suites/vault-sign-in.conformance.test.ts, suites/plugin-oauth), and how a
// turn uses the marks (run-approval). A listing has no run, so the retired
// "a connect that names its run" arm has no successor here; how the runner
// treats a `readOnlyHint` beside the destructive mark is the runner's unit
// arm.
import { Code } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import {
  DESTRUCTIVE_ECHO_TOOL_NAME,
  ECHO_TOOL_NAME,
  FAIL_TOOL_NAME,
  type FixtureTool,
  type McpToolFixture,
} from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { MockOAuthAuthorizationServer } from "@stigmer/test-support/oauth-authorization-server";
import { uniqueName } from "../support/naming";
import { FIXTURE_SERVER, oneServerPlugin, pluginToolDeclarer, pushPlugin } from "../support/plugins";
import { pushFixturePlugin, requireLlmProxy, requireMcpFixture } from "../support/runs";
import { myVaultTarget, setSecretsInput } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mockLlm: MockLlmProxy;
let mcpTools: McpToolFixture;
const fixtures = new FixtureTracker();
const mockAs = new MockOAuthAuthorizationServer();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mockLlm = requireLlmProxy(target);
  mcpTools = requireMcpFixture(target);
  await mockAs.start();
});

afterEach(async () => {
  mockAs.reset();
  mockLlm.reset();
  mcpTools.releaseHolds();
  mcpTools.resetCaptured();
  mcpTools.requireOAuth(undefined);
  await fixtures.cleanup();
});

afterAll(async () => {
  await mockAs.close();
  await target?.teardown();
});

// The mixed surface: one tool marked destructive, two that declare nothing.
const MIXED_SURFACE: readonly FixtureTool[] = [ECHO_TOOL_NAME, DESTRUCTIVE_ECHO_TOOL_NAME, FAIL_TOOL_NAME];

const MIXED_SURFACE_MARKS = {
  [ECHO_TOOL_NAME]: false,
  [DESTRUCTIVE_ECHO_TOOL_NAME]: true,
  [FAIL_TOOL_NAME]: false,
};

// The login key the install derives for a server named FIXTURE_SERVER.
const FIXTURE_ACCESS_TOKEN = `${FIXTURE_SERVER.toUpperCase()}_ACCESS_TOKEN`;

function listTools(plugin: Plugin, org: string, server: string = FIXTURE_SERVER) {
  return clients.pluginCommand.listTools({ pluginId: plugin.metadata!.id, server, org });
}

// Puts the fixture behind the mock login server (the hosted OAuth posture:
// a credential-less request is challenged, and the fixture's own RFC 9728
// document names this test's login server). A plugin installed while it is
// on is completed with a sign-in by the install's probe.
function challengeAt(address: string): void {
  mcpTools.requireOAuth({
    resourceMetadataUrl: `${new URL(address).origin}/.well-known/oauth-protected-resource${new URL(address).pathname}`,
    authorizationServerOrigin: mockAs.issuer(),
  });
}

// A URL-only plugin server at `address`, pushed while the fixture challenges,
// so the install completes it with oauth_only and its login key.
async function pushSignInPlugin(org: string, address: string): Promise<Plugin> {
  const plugin = await pushPlugin(
    clients,
    fixtures,
    org,
    oneServerPlugin({ name: uniqueName("signin-tool"), server: { url: address } }),
  );
  const entry = plugin.status?.mcpServers[0];
  expect(entry?.signIn?.oauthOnly, `${plugin.metadata?.name ?? ""} was completed with a sign-in at install`).toBe(true);
  expect(entry?.env).toEqual([FIXTURE_ACCESS_TOKEN]);
  return plugin;
}

// Signs the caller in at `address` into their My vault, which is removed
// with the test.
async function signIn(org: string, address: string): Promise<void> {
  const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
  await clients.vaultCommand.completeSignIn({ state: started.state, code: "conformance-auth-code" });
  const mine = await clients.vaultQuery.getMine({ org });
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
}

describe("[rpc:PluginCommandController.listTools] Plugin tools conformance — the request's own rules", () => {
  it("rejects a missing plugin id, server or organization (InvalidArgument each)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.pluginCommand.listTools({ pluginId: "", server: FIXTURE_SERVER, org }),
      Code.InvalidArgument,
      "empty plugin_id",
    );
    await expectGrpcCode(
      () => clients.pluginCommand.listTools({ pluginId: "plg_x", server: "", org }),
      Code.InvalidArgument,
      "empty server",
    );
    await expectGrpcCode(
      () => clients.pluginCommand.listTools({ pluginId: "plg_x", server: FIXTURE_SERVER, org: "" }),
      Code.InvalidArgument,
      "empty org",
    );
  });

  it("answers NotFound for a plugin that does not exist and for a server the plugin does not carry", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.pluginCommand.listTools({ pluginId: "plg_doesnotexist", server: FIXTURE_SERVER, org }),
      Code.NotFound,
      "unknown plugin",
    );
    const plugin = await pushFixturePlugin(clients, mcpTools, fixtures, {
      org,
      name: uniqueName("tools"),
      tools: [ECHO_TOOL_NAME],
    });
    const err = await expectGrpcCode(() => listTools(plugin, org, "elsewhere"), Code.NotFound, "unknown server");
    expect(err.rawMessage).toContain("elsewhere");
  });
});

describe("[rpc:PluginCommandController.listTools] Plugin tools conformance — a listing", () => {
  it("answers the server's tools with each one's destructive mark, asking no model", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcpTools, fixtures, {
      org,
      name: uniqueName("tools"),
      tools: MIXED_SURFACE,
    });

    const listed = await listTools(plugin, org);

    expect(Object.fromEntries(listed.tools.map((tool) => [tool.name, tool.destructive]))).toEqual(MIXED_SURFACE_MARKS);
    expect(listed.tools.every((tool) => tool.description !== ""), "each tool carries its description").toBe(true);
    expect(mockLlm.requests(), "a listing asks no model").toEqual([]);
  });

  it("stores nothing: the plugin, its digest, its audit and its history read the same after two listings", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcpTools, fixtures, {
      org,
      name: uniqueName("tools"),
      tools: MIXED_SURFACE,
    });
    const before = await clients.pluginQuery.get({ value: plugin.metadata!.id });
    const versionsBefore = await clients.pluginQuery.listVersions({ org, slug: plugin.metadata!.slug });

    await listTools(plugin, org);
    const again = await listTools(plugin, org);
    expect(again.tools.map((tool) => tool.name).sort()).toEqual([...MIXED_SURFACE].sort());

    const after = await clients.pluginQuery.get({ value: plugin.metadata!.id });
    expect(after, "the stored plugin is untouched").toEqual(before);
    expect(after.status?.digest).toBe(plugin.status?.digest);
    expect(after.status?.audit?.specAudit?.updatedAt).toEqual(before.status?.audit?.specAudit?.updatedAt);
    expect(after.status?.audit?.statusAudit?.updatedAt).toEqual(before.status?.audit?.statusAudit?.updatedAt);
    const versionsAfter = await clients.pluginQuery.listVersions({ org, slug: plugin.metadata!.slug });
    expect(versionsAfter.totalCount).toBe(versionsBefore.totalCount);
  });

  it("classifies an unreachable server as FailedPrecondition with the reachability guidance", async () => {
    const { org } = await target.provisionTenancy();
    // Port 9 (discard) on loopback: nothing listens there, so the install's
    // probe finds nothing (the entry stays as written) and the runner's
    // listing fails fast and deterministically.
    const name = uniqueName("unreachable");
    const plugin = await pushPlugin(
      clients,
      fixtures,
      org,
      oneServerPlugin({ name, server: { url: "http://127.0.0.1:9/mcp" } }),
    );

    const err = await expectGrpcCode(() => listTools(plugin, org), Code.FailedPrecondition, "unreachable server");
    // The middle of the message is the runner's classified cause (transport
    // text, not pinned); the frame around it names the server and says what
    // to check.
    expect(err.rawMessage).toContain(`listing the tools of ${pluginToolDeclarer(name)} failed:`);
    expect(err.rawMessage).toContain("Check that the server's address is reachable and your sign-in or key is valid");
  });
});

describe("[rpc:PluginCommandController.listTools] Plugin tools conformance — the caller's keys", () => {
  it("refuses a server whose required key is in none of the caller's vaults, naming the server and the key", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("nokey");
    const plugin = await pushFixturePlugin(clients, mcpTools, fixtures, {
      org,
      name,
      tools: [ECHO_TOOL_NAME],
      headers: { "X-Conf-Credential": "${CONF_REQUIRED_KEY}" },
    });

    const err = await expectGrpcCode(() => listTools(plugin, org), Code.FailedPrecondition, "a key saved nowhere");
    expect(err.rawMessage).toContain(`${pluginToolDeclarer(name)} needs CONF_REQUIRED_KEY`);
    expect(err.rawMessage).toContain("add CONF_REQUIRED_KEY to My vault");
    expect(mcpTools.capturedRequests().filter((request) => request.method === "tools/list")).toEqual([]);
  });

  it("lists a server that reads a key once My vault holds it — the runner fetches it and sends it to the server", async () => {
    // The key is saved as a secret in My vault (a listing carries no values
    // of its own), and the runner fetches it with the attempt's credential
    // and sends it in the header the server templates. A refused fetch
    // fails the listing loudly, so the tools, and the header the fixture
    // received, prove the fetch end to end.
    const { org } = await target.provisionTenancy();
    const mine = await clients.vaultCommand.setSecrets(
      setSecretsInput(myVaultTarget(org), { CONF_REQUIRED_KEY: "conformance-credential" }),
    );
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
    const plugin = await pushFixturePlugin(clients, mcpTools, fixtures, {
      org,
      name: uniqueName("credentialed"),
      tools: [ECHO_TOOL_NAME],
      headers: { "X-Conf-Credential": "${CONF_REQUIRED_KEY}" },
    });
    mcpTools.resetCaptured();

    const listed = await listTools(plugin, org);

    expect(listed.tools.map((tool) => tool.name)).toEqual([ECHO_TOOL_NAME]);
    const carried = mcpTools
      .capturedRequests()
      .map((request) => request.headers["x-conf-credential"])
      .filter((value) => value !== undefined);
    expect(carried.length, "the listing reached the fixture").toBeGreaterThan(0);
    expect(new Set(carried), "the value came from My vault").toEqual(new Set(["conformance-credential"]));
  });
});

describe("[rpc:PluginCommandController.listTools] Plugin tools conformance — a sign-in fills the servers at its address", () => {
  it("one sign-in at an address lets every plugin server at that address list, and refuses one at another, naming its login key", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    const elsewhereAddress = mcpTools.url([ECHO_TOOL_NAME, FAIL_TOOL_NAME]);
    challengeAt(address);
    const first = await pushSignInPlugin(org, address);
    const second = await pushSignInPlugin(org, address);
    const elsewhere = await pushSignInPlugin(org, elsewhereAddress);

    await signIn(org, address);
    mcpTools.resetCaptured();

    for (const plugin of [first, second]) {
      const listed = await listTools(plugin, org);
      expect(listed.tools.map((tool) => tool.name), `${plugin.metadata!.name} at the address`).toEqual([ECHO_TOOL_NAME]);
    }
    // Every request that reached the tool surface carried the login.
    const lists = mcpTools.capturedRequests().filter((request) => request.method === "tools/list");
    expect(lists.length).toBeGreaterThan(0);
    expect(
      lists.every((request) => String(request.headers.authorization ?? "").startsWith("Bearer mock-access-token-")),
    ).toBe(true);

    const err = await expectGrpcCode(() => listTools(elsewhere, org), Code.FailedPrecondition, "a server at another address");
    expect(err.rawMessage).toContain(`${pluginToolDeclarer(elsewhere.metadata!.name)} needs ${FIXTURE_ACCESS_TOKEN}`);
  });

  it("refuses a completed server nobody signed in to, asking for the sign-in", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    challengeAt(address);
    const plugin = await pushSignInPlugin(org, address);

    const err = await expectGrpcCode(() => listTools(plugin, org), Code.FailedPrecondition, "no sign-in");
    expect(err.rawMessage).toContain(`${pluginToolDeclarer(plugin.metadata!.name)} needs ${FIXTURE_ACCESS_TOKEN}`);
    expect(err.rawMessage).toContain(`sign in to ${pluginToolDeclarer(plugin.metadata!.name)}`);
  });
});

describe("[rpc:PluginCommandController.listTools] Plugin tools conformance — renewing a sign-in before the listing", () => {
  it("renews an expired sign-in through the refresh_token grant, naming the address as resource", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    challengeAt(address);
    const plugin = await pushSignInPlugin(org, address);
    // The sign-in is born inside the 60s renewal window, with a refresh
    // token to redeem.
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = true;
    await signIn(org, address);
    // The renewed token should be born healthy.
    mockAs.tokenExpiresIn = 3600;

    const listed = await listTools(plugin, org);

    expect(listed.tools.map((tool) => tool.name)).toEqual([ECHO_TOOL_NAME]);
    const refresh = mockAs.capturedTokenRequests().at(-1)!;
    expect(refresh.grantType).toBe("refresh_token");
    expect(refresh.refreshToken).toBe("mock-refresh-token-1");
    expect(refresh.clientId).toBe("mock-dcr-client-1");
    expect(refresh.secretChannel).toBe("none");
    expect(refresh.resource, "renewed for the address it was signed in for").toBe(address);
  });

  it("surfaces a failing renewal as FailedPrecondition naming the cause and asking to sign in again", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    challengeAt(address);
    const plugin = await pushSignInPlugin(org, address);
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = true;
    await signIn(org, address);
    mockAs.tokenStatus = 500;

    const err = await expectGrpcCode(() => listTools(plugin, org), Code.FailedPrecondition, "a failing renewal");
    expect(err.rawMessage).toContain("could not be renewed");
    expect(err.rawMessage).toContain(`token endpoint ${mockAs.tokenEndpoint()} returned HTTP 500`);
    expect(err.rawMessage).toContain("Sign in again");
  });

  it("refuses when the sign-in has expired and the login server issued no refresh token, asking nothing of the login server", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    challengeAt(address);
    const plugin = await pushSignInPlugin(org, address);
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = false;
    await signIn(org, address);
    const exchangesBefore = mockAs.capturedTokenRequests().length;

    const err = await expectGrpcCode(
      () => listTools(plugin, org),
      Code.FailedPrecondition,
      "an expired, unrenewable sign-in",
    );
    expect(err.rawMessage).toContain("has expired and no refresh token is available");
    expect(err.rawMessage).toContain("Sign in again");
    expect(mockAs.capturedTokenRequests().length, "no renewal attempt reaches the login server").toBe(exchangesBefore);
  });
});
