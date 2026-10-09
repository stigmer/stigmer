// Conformance suite for an MCP server's sign-in (Class A).
// Domain: agentic / mcpserver — the sign-in facet.
//
// A sign-in is not started from an MCP server: it starts from an address on
// the vault (suites/vault-sign-in.conformance.test.ts) and fills every HTTP
// tool whose URL is that address. What stays on the McpServer, and is pinned
// here:
//
//   - only an HTTP server may carry an auth block: a local program takes its
//     keys as environment variables, and a save that gives one an auth block
//     is refused;
//   - getOAuthGrantStatus reads the caller's sign-in at the server's address
//     in their My vault: a sign-in reads as connected on every server at its
//     address and on none at another, a pasted login is no sign-in, and the
//     health follows the sign-in's expiry and refresh token;
//   - disconnectOAuth removes that sign-in, leaves a pasted login alone, and
//     is idempotent.
//
// Every network counterparty is the suite-owned mock login server
// (test/support/src/oauth-authorization-server.ts). The use of the saved
// login by connect and runs is the execution class's
// (suites-execution/mcpserver-connect.conformance.test.ts).
import { Code } from "@connectrpc/connect";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { MockOAuthAuthorizationServer } from "@stigmer/test-support/oauth-authorization-server";
import { uniqueName } from "../support/naming";
import { MCPSERVER_API_VERSION, MCPSERVER_KIND, makeOAuthMcpServer } from "../support/mcpservers";
import { makeOAuthApp } from "../support/oauthapps";
import { myVaultTarget, setConnectionInput } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const mockAs = new MockOAuthAuthorizationServer();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  await mockAs.start();
});

afterEach(async () => {
  mockAs.reset();
  await fixtures.cleanup();
});

afterAll(async () => {
  await mockAs.close();
  await target?.teardown();
});

// The env var the fixtures declare as the token destination.
const TARGET_ENV_VAR = "CONF_OAUTH_TOKEN";

async function createOAuthMcpServer(org: string, url: string) {
  const created = await clients.mcpServerCommand.create(
    makeOAuthMcpServer({ org, name: uniqueName("signin-tool"), url, targetEnvVar: TARGET_ENV_VAR }),
  );
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: created.metadata!.id }));
  return created;
}

// Signs the caller in at an address (start, then complete against the mock),
// into their My vault, which is removed with the test.
async function signIn(org: string, address: string) {
  const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
  await clients.vaultCommand.completeSignIn({ state: started.state, code: "conformance-auth-code" });
  const mine = await clients.vaultQuery.getMine({ org });
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
}

async function statusOf(org: string, serverId: string) {
  return clients.mcpServerQuery.getOAuthGrantStatus({ resourceId: serverId, org });
}

describe("McpServer sign-in conformance — the auth block", () => {
  it("[rpc:McpServerCommandController.create] refuses an auth block on a local program (InvalidArgument), naming where its keys go", async () => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () =>
        clients.mcpServerCommand.create({
          apiVersion: MCPSERVER_API_VERSION,
          kind: MCPSERVER_KIND,
          metadata: { name: uniqueName("stdio-auth"), org },
          spec: {
            description: "a local program with a sign-in",
            serverType: { case: "stdio", value: { command: "conformance-oauth-noop" } },
            auth: { targetEnvVar: TARGET_ENV_VAR },
          },
        }),
      Code.InvalidArgument,
      "a local program with an auth block",
    );
    expect(err.rawMessage).toContain(
      "a local program takes its keys as environment variables: declare them in env",
    );
  });
});

describe("McpServer sign-in conformance — input guards (Layer 1)", () => {
  it("[rpc:McpServerQueryController.getOAuthGrantStatus] getOAuthGrantStatus rejects missing resource_id and org (InvalidArgument each)", async () => {
    await expectGrpcCode(
      () => clients.mcpServerQuery.getOAuthGrantStatus({ resourceId: "", org: "acme" }),
      Code.InvalidArgument,
      "grant status empty resource_id",
    );
    await expectGrpcCode(
      () => clients.mcpServerQuery.getOAuthGrantStatus({ resourceId: "mcp_x", org: "" }),
      Code.InvalidArgument,
      "grant status empty org",
    );
  });

  it("[rpc:McpServerCommandController.disconnectOAuth] disconnectOAuth rejects missing resource_id and org (InvalidArgument each)", async () => {
    await expectGrpcCode(
      () => clients.mcpServerCommand.disconnectOAuth({ resourceId: "", org: "acme" }),
      Code.InvalidArgument,
      "disconnect empty resource_id",
    );
    await expectGrpcCode(
      () => clients.mcpServerCommand.disconnectOAuth({ resourceId: "mcp_x", org: "" }),
      Code.InvalidArgument,
      "disconnect empty org",
    );
  });
});

describe("McpServer sign-in conformance — reading the sign-in at the server's address", () => {
  it("[rpc:McpServerQueryController.getOAuthGrantStatus] answers NO_GRANT for a server nobody signed in at", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer(org, mockAs.resourceAddress(uniqueName("tool")));
    const status = await statusOf(org, server.metadata!.id);
    expect(status.connected).toBe(false);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
  });

  it("[rpc:McpServerQueryController.getOAuthGrantStatus] a sign-in at an address reads as connected on every server at that address, and on none at another", async () => {
    const { org } = await target.provisionTenancy();
    const address = mockAs.resourceAddress(uniqueName("shared"));
    const first = await createOAuthMcpServer(org, address);
    const second = await createOAuthMcpServer(org, address);
    const elsewhere = await createOAuthMcpServer(org, mockAs.resourceAddress(uniqueName("other")));

    await signIn(org, address);

    for (const server of [first, second]) {
      const status = await statusOf(org, server.metadata!.id);
      expect(status.connected, `${server.metadata!.name} at the address`).toBe(true);
      expect(status.authMethod).toBe("mcp_oauth");
      expect(status.targetEnvVar).toBe(TARGET_ENV_VAR);
      expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);
    }
    const other = await statusOf(org, elsewhere.metadata!.id);
    expect(other.connected, "a server at another address").toBe(false);
  });

  it("[rpc:McpServerQueryController.getOAuthGrantStatus] a sign-in through the organization's login app reads its auth method as vendor_oauth", async () => {
    const { org } = await target.provisionTenancy();
    const address = mockAs.resourceAddress(uniqueName("vendor"));
    const app = await clients.oauthAppCommand.create(
      makeOAuthApp(org, uniqueName("app"), { addresses: [address], tokenUrl: mockAs.tokenEndpoint() }),
    );
    fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
    const server = await createOAuthMcpServer(org, address);

    await signIn(org, address);

    expect((await statusOf(org, server.metadata!.id)).authMethod).toBe("vendor_oauth");
  });

  it("[rpc:McpServerQueryController.getOAuthGrantStatus] a pasted login at the address is no sign-in", async () => {
    const { org } = await target.provisionTenancy();
    const address = mockAs.resourceAddress(uniqueName("pasted"));
    const server = await createOAuthMcpServer(org, address);
    const mine = await clients.vaultCommand.setConnection(setConnectionInput(myVaultTarget(org), address, "pasted-token"));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));

    const status = await statusOf(org, server.metadata!.id);
    expect(status.connected).toBe(false);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
  });

  it("[rpc:McpServerQueryController.getOAuthGrantStatus] reports HEALTHY for a token with no expiry (expires_in absent means never expires)", async () => {
    const { org } = await target.provisionTenancy();
    const address = mockAs.resourceAddress(uniqueName("noexpiry"));
    const server = await createOAuthMcpServer(org, address);
    mockAs.tokenExpiresIn = undefined;
    await signIn(org, address);

    const status = await statusOf(org, server.metadata!.id);
    expect(status.accessTokenExpiresAt).toBe(0n);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);
  });

  it("[rpc:McpServerQueryController.getOAuthGrantStatus] reports TOKEN_EXPIRED_REFRESHABLE inside the 60s renewal buffer when a refresh token exists, and TOKEN_EXPIRED when none does", async () => {
    const { org } = await target.provisionTenancy();
    // 30s < the 60s buffer: the sign-in is born inside the renewal window.
    mockAs.tokenExpiresIn = 30;

    const refreshable = mockAs.resourceAddress(uniqueName("refreshable"));
    const refreshableServer = await createOAuthMcpServer(org, refreshable);
    mockAs.issueRefreshToken = true;
    await signIn(org, refreshable);
    expect((await statusOf(org, refreshableServer.metadata!.id)).connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE,
    );

    const expired = mockAs.resourceAddress(uniqueName("expired"));
    const expiredServer = await createOAuthMcpServer(org, expired);
    mockAs.issueRefreshToken = false;
    const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: expired });
    await clients.vaultCommand.completeSignIn({ state: started.state, code: "code" });
    expect((await statusOf(org, expiredServer.metadata!.id)).connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED,
    );
  });
});

describe("McpServer sign-in conformance — disconnect", () => {
  it("[rpc:McpServerCommandController.disconnectOAuth] is idempotent: a server nobody signed in at answers disconnected=false, not an error", async () => {
    // A real owned server (the real-owned-resource convention, #851): on the
    // multi-tenant edition a fabricated id fails closed in authorization
    // before the handler runs.
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer(org, mockAs.resourceAddress(uniqueName("nogrant")));
    const out = await clients.mcpServerCommand.disconnectOAuth({ resourceId: server.metadata!.id, org });
    expect(out.disconnected).toBe(false);
  });

  it("[rpc:McpServerCommandController.disconnectOAuth] removes the sign-in at the server's address from My vault, then answers false on repeat", async () => {
    const { org } = await target.provisionTenancy();
    const address = mockAs.resourceAddress(uniqueName("teardown"));
    const server = await createOAuthMcpServer(org, address);
    await signIn(org, address);

    const first = await clients.mcpServerCommand.disconnectOAuth({ resourceId: server.metadata!.id, org });
    expect(first.disconnected).toBe(true);
    expect((await statusOf(org, server.metadata!.id)).connected).toBe(false);
    const mine = await clients.vaultQuery.getMine({ org });
    expect(Object.keys(mine.spec?.connections ?? {}), "the login and its tokens are gone").toEqual([]);

    const second = await clients.mcpServerCommand.disconnectOAuth({ resourceId: server.metadata!.id, org });
    expect(second.disconnected).toBe(false);
  });

  it("[rpc:McpServerCommandController.disconnectOAuth] leaves a pasted login at the address in place", async () => {
    const { org } = await target.provisionTenancy();
    const address = mockAs.resourceAddress(uniqueName("keep-pasted"));
    const server = await createOAuthMcpServer(org, address);
    const mine = await clients.vaultCommand.setConnection(setConnectionInput(myVaultTarget(org), address, "pasted-token"));
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));

    const out = await clients.mcpServerCommand.disconnectOAuth({ resourceId: server.metadata!.id, org });
    expect(out.disconnected).toBe(false);
    const after = await clients.vaultQuery.getMine({ org });
    expect(Object.keys(after.spec?.connections ?? {})).toEqual([address]);
  });
});
