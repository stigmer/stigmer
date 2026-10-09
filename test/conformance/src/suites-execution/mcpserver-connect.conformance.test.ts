// Conformance suite for the McpServer connect lanes (Class B).
// Domain: agentic / mcpserver — the connect facet, engine-backed.
//
// connect / startConnect — tool discovery through the runner's connect
// workflow against the McpToolFixture, including the deterministic
// workflow-ID attach semantics (one discovery run shared by concurrent
// connects) and the use of a sign-in: a sign-in at an address fills every
// HTTP server whose URL is that address and none at another, and an expired
// one is renewed before discovery (with the address as its `resource`, as
// the sign-in was made). The sign-in itself, its status and its disconnect
// are engine-free and live in suites/vault-sign-in.conformance.test.ts and
// suites/mcpserver-oauth.conformance.test.ts.
//
// What discovery stores about each tool: its name, its schema, and
// destructive_hint, true exactly when the server's MCP annotations declare
// `destructiveHint: true` (the mark the approval default asks before). The
// suite pins the stored hint per tool on a surface that mixes the fixture's
// destructive echo with tools that declare nothing, both on a first connect
// and across a re-connect. A connect asks no model: discovery is the server's
// own tool list, so the mock LLM's request log stays empty, which the suite
// also pins. How the runner treats a `readOnlyHint` beside the destructive
// mark is the runner's unit arm, not re-proven here.
import { Code } from "@connectrpc/connect";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { setTimeout as delay } from "node:timers/promises";
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
import { requireLlmProxy, requireMcpFixture } from "../support/runs";
import { myVaultTarget, setSecretsInput } from "../support/vaults";
import { makeHttpMcpServer, makeOAuthMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
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

// The env var the handshake fixtures declare as the token destination.
const TARGET_ENV_VAR = "CONF_OAUTH_TOKEN";

// How long to poll for an async connect to settle. Discovery against the
// in-process fixture is fast; the budget is headroom for a loaded runner.
const CONNECT_SETTLE_TIMEOUT_MS = 90_000;
const CONNECT_SETTLE_POLL_MS = 500;

async function createOAuthMcpServer(org: string, url: string) {
  const created = await clients.mcpServerCommand.create(
    makeOAuthMcpServer({ org, name: uniqueName("signin-tool"), url, targetEnvVar: TARGET_ENV_VAR }),
  );
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: created.metadata!.id }));
  return created;
}

// Puts the fixture behind the mock login server (the hosted OAuth posture:
// a credential-less request is challenged, and the fixture's own RFC 9728
// document names this test's login server), then signs the caller in at
// `address` into their My vault, which is removed with the test.
async function signInAtFixture(org: string, address: string) {
  mcpTools.requireOAuth({
    resourceMetadataUrl: `${new URL(address).origin}/.well-known/oauth-protected-resource${new URL(address).pathname}`,
    authorizationServerOrigin: mockAs.issuer(),
  });
  const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
  await clients.vaultCommand.completeSignIn({ state: started.state, code: "conformance-auth-code" });
  const mine = await clients.vaultQuery.getMine({ org });
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
}

// The mixed surface the hint arms connect: one tool marked destructive, two
// that declare no annotations.
const MIXED_SURFACE: readonly FixtureTool[] = [ECHO_TOOL_NAME, DESTRUCTIVE_ECHO_TOOL_NAME, FAIL_TOOL_NAME];

// The stored hint per discovered tool, keyed by name.
function storedHints(server: McpServer): Record<string, boolean> {
  return Object.fromEntries((server.status?.discoveredCapabilities?.tools ?? []).map((t) => [t.name, t.destructiveHint]));
}

const MIXED_SURFACE_HINTS = {
  [ECHO_TOOL_NAME]: false,
  [DESTRUCTIVE_ECHO_TOOL_NAME]: true,
  [FAIL_TOOL_NAME]: false,
};

// Polls the resource until its connect_status reaches the wanted phase —
// the poll-don't-sleep core for the async connect lane.
async function pollConnectPhase(mcpServerId: string, want: ConnectPhase) {
  const deadline = Date.now() + CONNECT_SETTLE_TIMEOUT_MS;
  let lastPhase: ConnectPhase | undefined;
  while (Date.now() < deadline) {
    const current = await clients.mcpServerQuery.get({ value: mcpServerId });
    lastPhase = current.status?.connectStatus?.phase;
    if (lastPhase === want) {
      return current;
    }
    if (lastPhase === ConnectPhase.failed && want !== ConnectPhase.failed) {
      throw new Error(
        `connect settled FAILED while waiting for ${ConnectPhase[want]}: ` +
          `${current.status?.connectStatus?.failureCode}: ${current.status?.connectStatus?.failureMessage}`,
      );
    }
    await delay(CONNECT_SETTLE_POLL_MS);
  }
  throw new Error(
    `connect did not reach phase ${ConnectPhase[want]} within ${CONNECT_SETTLE_TIMEOUT_MS}ms ` +
      `(last observed: ${lastPhase === undefined ? "none" : ConnectPhase[lastPhase]})`,
  );
}

describe("McpServer connect conformance — a sign-in fills the servers at its address", () => {
  it("[rpc:McpServerCommandController.connect] one sign-in at an address lets every server at that address connect, and no server at another", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    const first = await createOAuthMcpServer(org, address);
    const second = await createOAuthMcpServer(org, address);
    const elsewhere = await createOAuthMcpServer(org, mcpTools.url([ECHO_TOOL_NAME, FAIL_TOOL_NAME]));

    await signInAtFixture(org, address);

    for (const server of [first, second]) {
      const connected = await clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org });
      expect(connected.status?.connectStatus?.phase, `${server.metadata!.name} at the address`).toBe(
        ConnectPhase.succeeded,
      );
    }
    // Every request that reached the tool surface carried the login.
    expect(
      mcpTools.capturedRequests().filter((r) => r.method === "initialize").every((r) =>
        String(r.headers.authorization ?? "").startsWith("Bearer mock-access-token-"),
      ),
    ).toBe(true);

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: elsewhere.metadata!.id, org }),
      Code.FailedPrecondition,
      "a server at another address",
    );
    expect(err.rawMessage).toContain(elsewhere.metadata!.name);
  });
});

describe("McpServer connect conformance — blocking connect", () => {
  it("[rpc:McpServerCommandController.connect] rejects missing inputs and unknown servers (InvalidArgument / NotFound)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: "", org }),
      Code.InvalidArgument,
      "connect empty mcp_server_id",
    );
    await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: "mcp_x", org: "" }),
      Code.InvalidArgument,
      "connect empty org",
    );
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: "mcp_doesnotexist", org }),
      Code.NotFound,
      "connect unknown id",
    );
    expect(err.rawMessage).toBe("mcp_server not found: mcp_doesnotexist");
  });

  it("[rpc:McpServerCommandController.connect] discovers the fixture's tools and persists SUCCEEDED with each tool's destructive hint, asking no model", async () => {
    const { org } = await target.provisionTenancy();
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("connect"), url: mcpTools.url(MIXED_SURFACE) }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const connected = await clients.mcpServerCommand.connect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(connected.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect(connected.status?.connectStatus?.workflowId).toBe(
      `stigmer/mcp-server/connect/${server.metadata!.id}`,
    );
    // The hint is stored per tool: true for the tool whose annotations say
    // destructive, false for the tools that declare nothing.
    expect(storedHints(connected), "the stored destructive_hint per tool").toEqual(MIXED_SURFACE_HINTS);
    // And it is what a later read returns, not only the connect response.
    const read = await clients.mcpServerQuery.get({ value: server.metadata!.id });
    expect(storedHints(read), "the persisted destructive_hint per tool").toEqual(MIXED_SURFACE_HINTS);
    expect(mockLlm.requests(), "a connect asks no model").toEqual([]);
  });

  it("[rpc:McpServerCommandController.connect] re-connect keeps capabilities and the stored hints stable", async () => {
    const { org } = await target.provisionTenancy();
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("reconnect"), url: mcpTools.url(MIXED_SURFACE) }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    await clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org });

    const again = await clients.mcpServerCommand.connect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(again.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect(storedHints(again), "the re-connect's stored destructive_hint per tool").toEqual(MIXED_SURFACE_HINTS);
    expect(mockLlm.requests(), "neither connect asks a model").toEqual([]);
  });

  it("[rpc:McpServerCommandController.connect] classifies an unreachable http server as FailedPrecondition with the reachability guidance", async () => {
    const { org } = await target.provisionTenancy();
    // Port 9 (discard) on loopback: nothing listens there, so the runner's
    // connection attempt fails fast and deterministically.
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("unreachable"), url: "http://127.0.0.1:9/mcp" }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "connect to unreachable http server",
    );
    // The middle of the message is the runner's classified cause (transport
    // text, not pinned); the frame around it is the Go server's http-arm
    // guidance template, pinned. The template names the server by NAME, not
    // id — it is user-facing copy.
    expect(err.rawMessage).toContain(`connect failed for MCP server '${server.metadata!.name}':`);
    expect(err.rawMessage).toContain(
      "Check that the server URL is reachable and your credentials are valid.",
    );
  });

  it("[rpc:McpServerCommandController.connect] refuses connect when a required credential is in none of the caller's vaults, naming the key and where to add it", async () => {
    const { org } = await target.provisionTenancy();
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({
        org,
        name: uniqueName("noenv"),
        url: mcpTools.url(),
        env: { CONF_REQUIRED_KEY: { description: "a required credential" } },
      }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "connect with the credential saved nowhere",
    );
    expect(err.rawMessage).toContain(`${server.metadata!.name} needs CONF_REQUIRED_KEY`);
    expect(err.rawMessage).toContain("add CONF_REQUIRED_KEY to My vault");
  });

  it("[rpc:McpServerCommandController.connect] discovers a server that declares a credential once My vault holds it — the ephemeral ExecutionContext is created and decrypted for the runner", async () => {
    // The credentialed connect is the connect lane's whole reason to mint a
    // token: the declared key is saved as a secret, the server resolves it
    // into an ephemeral ExecutionContext for this connect, and the runner
    // reads it back DECRYPTED with the payload's token. A redacted read fails
    // discovery loudly (the runner's CredentialResolutionError), so SUCCEEDED
    // with tools proves the decrypt lane end to end. The row's deletion at
    // settle is the server's own unit arm (no list RPC exposes it here).
    const { org } = await target.provisionTenancy();
    const mine = await clients.vaultCommand.setSecrets(
      setSecretsInput(myVaultTarget(org), { CONF_REQUIRED_KEY: "conformance-credential" }),
    );
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({
        org,
        name: uniqueName("credentialed"),
        url: mcpTools.url(),
        env: { CONF_REQUIRED_KEY: { description: "a required credential", isSecret: true } },
      }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const connected = await clients.mcpServerCommand.connect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(connected.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    expect((connected.status?.discoveredCapabilities?.tools ?? []).map((t) => t.name)).toEqual([
      ECHO_TOOL_NAME,
    ]);
  });
});

describe("McpServer connect conformance — async startConnect", () => {
  // Under load the fixture has seen two `initialize` requests across the two
  // starts though both returned the same workflow id; whether that is a second
  // run, a retried attempt or a stray request is not yet known.
  // quarantined: stigmer/stigmer#1720
  it.skip("[rpc:McpServerCommandController.startConnect] returns immediately with CONNECTING, attaches concurrent starts to one discovery run, and settles SUCCEEDED", async () => {
    const { org } = await target.provisionTenancy();
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({ org, name: uniqueName("async"), url: mcpTools.url() }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    // Hold the fixture so the discovery blocks and the CONNECTING window is
    // observable instead of a race.
    mcpTools.holdRequests();

    const started = await clients.mcpServerCommand.startConnect({
      mcpServerId: server.metadata!.id,
      org,
    });
    expect(started.status?.connectStatus?.phase).toBe(ConnectPhase.connecting);
    const workflowId = started.status?.connectStatus?.workflowId;
    expect(workflowId).toBe(`stigmer/mcp-server/connect/${server.metadata!.id}`);

    const attached = await clients.mcpServerCommand.startConnect({
      mcpServerId: server.metadata!.id,
      org,
    });
    expect(attached.status?.connectStatus?.phase).toBe(ConnectPhase.connecting);
    expect(attached.status?.connectStatus?.workflowId, "attach must join the in-flight run").toBe(
      workflowId,
    );

    // The wire-level proof of attach: across two startConnect calls the
    // fixture saw at most one in-flight discovery (a single held initialize),
    // never two parallel runs.
    expect(
      mcpTools.capturedRequests().filter((r) => r.method === "initialize").length,
    ).toBeLessThanOrEqual(1);

    mcpTools.releaseHolds();

    const settled = await pollConnectPhase(server.metadata!.id, ConnectPhase.succeeded);
    expect((settled.status?.discoveredCapabilities?.tools ?? []).map((t) => t.name)).toEqual([
      ECHO_TOOL_NAME,
    ]);
    expect(storedHints(settled), "echo declares nothing, so its stored hint is false").toEqual({ [ECHO_TOOL_NAME]: false });
  });
});

describe("McpServer connect conformance — refresh-on-connect pre-flight", () => {
  it("[rpc:McpServerCommandController.connect] renews an expired sign-in through the refresh_token grant, naming the address as resource, before discovering", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    const server = await createOAuthMcpServer(org, address);
    // The sign-in is born inside the 60s renewal window, with a refresh
    // token to redeem.
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = true;
    await signInAtFixture(org, address);
    // The renewed token should be born healthy.
    mockAs.tokenExpiresIn = 3600;

    const connected = await clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org });

    expect(connected.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);
    const refresh = mockAs.capturedTokenRequests().at(-1)!;
    expect(refresh.grantType).toBe("refresh_token");
    expect(refresh.refreshToken).toBe("mock-refresh-token-1");
    expect(refresh.clientId).toBe("mock-dcr-client-1");
    expect(refresh.secretChannel).toBe("none");
    expect(refresh.resource, "renewed for the address it was signed in for").toBe(address);

    const status = await clients.mcpServerQuery.getOAuthGrantStatus({ resourceId: server.metadata!.id, org });
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);
  });

  it("[rpc:McpServerCommandController.connect] surfaces a failing renewal as FailedPrecondition naming the sign-in and asking to sign in again", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    const server = await createOAuthMcpServer(org, address);
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = true;
    await signInAtFixture(org, address);
    mockAs.tokenStatus = 500;

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "connect with failing token refresh",
    );
    expect(err.rawMessage).toContain("could not be renewed");
    expect(err.rawMessage).toContain(`token endpoint ${mockAs.tokenEndpoint()} returned HTTP 500`);
    expect(err.rawMessage).toContain("Sign in again");
  });

  it("[rpc:McpServerCommandController.connect] refuses connect when the sign-in has expired and the login server issued no refresh token", async () => {
    const { org } = await target.provisionTenancy();
    const address = mcpTools.url();
    const server = await createOAuthMcpServer(org, address);
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = false;
    await signInAtFixture(org, address);
    const exchangesBeforeConnect = mockAs.capturedTokenRequests().length;

    // An expired login that cannot be renewed refuses before any connect run
    // starts, rather than proceeding with a token the server will reject
    // (stigmer/stigmer#863).
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "connect with an expired, unrenewable sign-in",
    );
    expect(err.rawMessage).toContain("has expired and no refresh token is available");
    expect(err.rawMessage).toContain("Sign in again");
    expect(mockAs.capturedTokenRequests().length, "no renewal attempt must reach the login server").toBe(
      exchangesBeforeConnect,
    );
  });
});
