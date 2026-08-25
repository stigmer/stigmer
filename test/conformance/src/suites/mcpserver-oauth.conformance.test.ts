// Conformance suite for the McpServer OAuth initiate lanes (CW-1, Class A).
// Domain: agentic / mcpserver — the connect/OAuth facet, engine-free half.
//
// Pins initiateOAuthConnect (both arms: DCR and vendor), the Layer-1 input
// guards of the other handshake RPCs, the grant-free reads (NO_GRANT,
// idempotent disconnect), and the three org-OAuth-app UNIMPLEMENTED refusals —
// against a suite-owned mock OAuth authorization server
// (harness/oauth-authorization-server.ts).
//
// Why exactly this slice is Class A: the Go server injects the OAuth stores
// and redirect URI unconditionally, so initiate works with no Temporal behind
// the server — but completeOAuthConnect ALSO requires the managed environment
// service, which server.go builds only inside the Temporal-gated
// SetConnectDependencies. On the Temporal-less local target, complete
// refuses before validating input. The handshake-completion scenarios
// (complete/grant-health/disconnect-teardown) therefore live in
// suites-execution/mcpserver-connect.conformance.test.ts, where the engine is
// provisioned — see that suite's header for the full flow.
//
// The refusal and guidance copy is byte-pinned: these strings are user-facing
// (the SDK's getUserMessage passes initiate errors through verbatim) and they
// are the porting contract for the TS server's mcpserver connect/OAuth slice.
import { Code } from "@connectrpc/connect";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { MockOAuthAuthorizationServer } from "../harness/oauth-authorization-server";
import { CONFORMANCE_OAUTH_REDIRECT_URI } from "../harness/server-process";
import { uniqueName } from "../support/naming";
import {
  MCPSERVER_API_VERSION,
  MCPSERVER_KIND,
  makeOAuthMcpServer,
  type OAuthMcpServerOptions,
} from "../support/mcpservers";
import { makeOAuthApp, type OAuthAppOptions } from "../support/oauthapps";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const mockAs = new MockOAuthAuthorizationServer();

// Collection-time capability read (construction is cheap and boots nothing —
// the schedule-firing convention): decides whether the org-OAuth-app
// UNIMPLEMENTED pins apply to this target.
const orgOAuthAppConfigured = createTarget().capabilities.orgOAuthAppConfiguration;

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

// The host segment of the harness redirect URI, as the DCR pre-flight
// rejection copy renders it (url.Parse(...).Host in Go).
const REDIRECT_CALLBACK_HOST = new URL(CONFORMANCE_OAUTH_REDIRECT_URI).host;

async function createOAuthMcpServer(opts: Omit<OAuthMcpServerOptions, "targetEnvVar">) {
  const created = await clients.mcpServerCommand.create(
    makeOAuthMcpServer({ ...opts, targetEnvVar: TARGET_ENV_VAR }),
  );
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: created.metadata!.id }));
  return created;
}

async function createVendorOAuthApp(org: string, name: string, opts: OAuthAppOptions = {}) {
  const created = await clients.oauthAppCommand.create(
    makeOAuthApp(org, name, { tokenUrl: mockAs.tokenEndpoint(), ...opts }),
  );
  fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: created.metadata!.id }));
  return created;
}

describe("McpServer OAuth conformance — initiateOAuthConnect guards", () => {
  it("rejects an empty mcp_server_id (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: "", org }),
      Code.InvalidArgument,
      "initiate empty mcp_server_id",
    );
  });

  it("rejects an empty org (InvalidArgument)", () =>
    expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: "mcp_x", org: "" }),
      Code.InvalidArgument,
      "initiate empty org",
    ));

  it("reports NotFound for an unknown mcp_server_id", async () => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: "mcp_doesnotexist", org }),
      Code.NotFound,
      "initiate unknown id",
    );
    expect(err.rawMessage).toBe("mcp_server not found: mcp_doesnotexist");
  });

  it("refuses a server without an auth block (FailedPrecondition, pinned copy)", async () => {
    const { org } = await target.provisionTenancy();
    // No-auth shape written inline: the support builder represents validity
    // for the OAuth facet, and "no auth block" is its deliberate negative.
    const server = await clients.mcpServerCommand.create({
      apiVersion: MCPSERVER_API_VERSION,
      kind: MCPSERVER_KIND,
      metadata: { name: uniqueName("noauth"), org },
      spec: {
        description: "no auth block",
        serverType: { case: "stdio", value: { command: "conformance-oauth-noop" } },
      },
    });
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate without auth block",
    );
    expect(err.rawMessage).toBe(
      `MCP server '${server.metadata!.id}' does not have an auth block configured`,
    );
  });

  it("refuses DCR with neither http.url nor discovery_url (FailedPrecondition, pinned copy)", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer({ org, name: uniqueName("nodisc") });
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate without discoverable URL",
    );
    expect(err.rawMessage).toBe(
      `DCR requires a discoverable URL. MCP server '${server.metadata!.id}' has no http.url and no auth.discovery_url. ` +
        "Set auth.discovery_url for stdio servers, oauth_app_ref for vendor OAuth, or switch to HTTP transport",
    );
  });

  it("surfaces a discovery failure (non-200 metadata) as FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("disc500"),
      discoveryUrl: mockAs.origin(),
    });
    mockAs.discoveryStatus = 503;
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate with failing discovery",
    );
    expect(err.rawMessage).toBe(
      `OAuth authorization server discovery failed for ${mockAs.origin()}: ` +
        `authorization server discovery failed: ${mockAs.origin()}/.well-known/oauth-authorization-server ` +
        "returned HTTP 503 (expected 200). This MCP server may not support the MCP Authorization specification",
    );
  });

  it("refuses a provider that advertises no registration_endpoint (FailedPrecondition, pinned copy)", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("nodcr"),
      discoveryUrl: mockAs.origin(),
    });
    mockAs.omitRegistrationEndpoint = true;
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate without registration endpoint",
    );
    expect(err.rawMessage).toBe(
      `MCP server at ${mockAs.origin()} does not advertise a registration_endpoint for DCR`,
    );
  });
});

describe("McpServer OAuth conformance — initiate, DCR arm", () => {
  it("discovers, registers via DCR, and returns a PKCE S256 authorization URL", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dcr");
    const server = await createOAuthMcpServer({
      org,
      name,
      discoveryUrl: mockAs.origin(),
      scopeHints: ["files:read", "files:write"],
    });

    const out = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(out.state, "state must be a generated handshake token").not.toBe("");
    expect(out.providerName, "DCR arm names the provider after the server").toBe(name);
    expect(out.scopes).toEqual(["files:read", "files:write"]);

    // Discovery hit the RFC 8414 well-known path at the origin.
    expect(mockAs.capturedDiscoveryPaths()).toEqual(["/.well-known/oauth-authorization-server"]);

    // DCR registered a public client with the documented request shape.
    expect(mockAs.capturedDcrRequests()).toHaveLength(1);
    const dcr = mockAs.capturedDcrRequests()[0]!;
    expect(dcr.client_name).toBe(`Stigmer (${name})`);
    expect(dcr.token_endpoint_auth_method).toBe("none");
    expect(dcr.grant_types).toEqual(["authorization_code"]);
    expect(dcr.response_types).toEqual(["code"]);
    expect(dcr.redirect_uris).toEqual([CONFORMANCE_OAUTH_REDIRECT_URI]);

    // The authorization URL carries the full pinned parameter set.
    const authUrl = new URL(out.authorizationUrl);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe(mockAs.authorizationEndpoint());
    expect(authUrl.searchParams.get("response_type")).toBe("code");
    expect(authUrl.searchParams.get("client_id")).toBe("mock-dcr-client-1");
    expect(authUrl.searchParams.get("redirect_uri")).toBe(CONFORMANCE_OAUTH_REDIRECT_URI);
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("code_challenge")).not.toBeNull();
    expect(authUrl.searchParams.get("state")).toBe(out.state);
    expect(authUrl.searchParams.get("scope")).toBe("files:read files:write");

    // The pre-flight probe fetched exactly that URL server-side.
    expect(mockAs.capturedAuthorizeProbes()).toHaveLength(1);
    expect(mockAs.capturedAuthorizeProbes()[0]!.params.get("state")).toBe(out.state);
  });

  it("falls back to the provider's scopes_supported when the server declares no scope_hints", async () => {
    const { org } = await target.provisionTenancy();
    mockAs.scopesSupported = ["discovered:a", "discovered:b"];
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("dcrscopes"),
      discoveryUrl: mockAs.origin(),
    });

    const out = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(out.scopes).toEqual(["discovered:a", "discovered:b"]);
    const authUrl = new URL(out.authorizationUrl);
    expect(authUrl.searchParams.get("scope")).toBe("discovered:a discovered:b");
  });

  it("blocks initiate when the authorize pre-flight answers 400, with the pinned rejection copy", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dcrblocked");
    const server = await createOAuthMcpServer({ org, name, discoveryUrl: mockAs.origin() });
    mockAs.authorizeStatus = 400;
    mockAs.authorizeErrorBody = { error: "invalid_request", error_description: "redirect host not allowed" };

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate with pre-flight 400",
    );
    expect(err.rawMessage).toBe(
      `${name} rejected the sign-in request before showing a login page (HTTP 400). ` +
        `The most common cause is a redirect-host allowlist: this deployment's OAuth callback host (${REDIRECT_CALLBACK_HOST}) ` +
        "is not on the provider's approved list. Self-hosted deployments with a localhost callback are typically unaffected. " +
        "Provider detail: redirect host not allowed",
    );
  });

  it("omits the provider detail when the 400 body is an HTML error page", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dcrhtml");
    const server = await createOAuthMcpServer({ org, name, discoveryUrl: mockAs.origin() });
    mockAs.authorizeStatus = 400;
    mockAs.authorizeErrorBody = "<html><body>vendor error page</body></html>";

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate with HTML pre-flight 400",
    );
    expect(err.rawMessage).toBe(
      `${name} rejected the sign-in request before showing a login page (HTTP 400). ` +
        `The most common cause is a redirect-host allowlist: this deployment's OAuth callback host (${REDIRECT_CALLBACK_HOST}) ` +
        "is not on the provider's approved list. Self-hosted deployments with a localhost callback are typically unaffected.",
    );
  });

  it("fails open when the authorize pre-flight answers a non-400 error (bot-wall contract)", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("dcrbotwall"),
      discoveryUrl: mockAs.origin(),
    });
    // 403 is the bot-protection shape: server-side GETs blocked while real
    // browsers pass. Only a definite 400 may block initiate.
    mockAs.authorizeStatus = 403;
    mockAs.authorizeErrorBody = { error: "forbidden" };

    const out = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(out.state).not.toBe("");
    expect(out.authorizationUrl).not.toBe("");
  });
});

describe("McpServer OAuth conformance — initiate, vendor arm", () => {
  it("reports NotFound for an unresolvable oauth_app_ref", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("vnoapp"),
      oauthAppSlug: "does-not-exist",
    });
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.NotFound,
      "initiate with unknown oauth_app",
    );
    expect(err.rawMessage).toBe("oauth_app not found: does-not-exist");
  });

  it("refuses a vendor-PENDING app with the manual-token alternative (pinned copy)", async () => {
    const { org } = await target.provisionTenancy();
    const app = await createVendorOAuthApp(org, uniqueName("vpending"), {
      vendorApprovalStatus: VendorApprovalStatus.PENDING,
    });
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("vpendingsrv"),
      oauthAppSlug: app.metadata!.slug,
    });

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate with pending vendor approval",
    );
    expect(err.rawMessage).toBe(
      "OAuth sign-in is unavailable: the platform's OAuth app for 'ConformanceVendor' is pending approval by the vendor. " +
        "Please enter a token manually instead.",
    );
  });

  it("refuses a vendor-REJECTED oauth_only server with the BYOA alternative (pinned copy)", async () => {
    const { org } = await target.provisionTenancy();
    const app = await createVendorOAuthApp(org, uniqueName("vrejected"), {
      vendorApprovalStatus: VendorApprovalStatus.REJECTED,
    });
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("vrejectedsrv"),
      oauthAppSlug: app.metadata!.slug,
      oauthOnly: true,
    });

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.initiateOAuthConnect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "initiate with rejected vendor approval on oauth_only",
    );
    expect(err.rawMessage).toBe(
      "OAuth sign-in is unavailable: the platform's OAuth app for 'ConformanceVendor' is rejected by the vendor. " +
        "This server only accepts OAuth sign-in; an org admin can configure your own OAuth app instead.",
    );
  });

  it("builds the authorization URL from the OAuthApp, honoring a custom scope parameter name", async () => {
    const { org } = await target.provisionTenancy();
    const app = await createVendorOAuthApp(org, uniqueName("vhappy"), {
      scopeParameterName: "user_scope",
    });
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("vhappysrv"),
      oauthAppSlug: app.metadata!.slug,
    });

    const out = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(out.providerName, "vendor arm names the provider after the OAuthApp").toBe("ConformanceVendor");
    expect(out.scopes).toEqual(["read", "write"]);
    const authUrl = new URL(out.authorizationUrl);
    expect(`${authUrl.origin}${authUrl.pathname}`).toBe("https://vendor.example.com/oauth/authorize");
    expect(authUrl.searchParams.get("client_id")).toBe("conformance-client-id");
    expect(authUrl.searchParams.get("user_scope")).toBe("read write");
    expect(authUrl.searchParams.get("scope"), "the default parameter name must be replaced").toBeNull();
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    // Vendor initiate is network-free: no discovery, no DCR, no pre-flight.
    expect(mockAs.capturedDiscoveryPaths()).toHaveLength(0);
    expect(mockAs.capturedAuthorizeProbes()).toHaveLength(0);
  });
});

describe("McpServer OAuth conformance — handshake input guards (Layer 1)", () => {
  it("completeOAuthConnect rejects missing inputs (InvalidArgument each)", async () => {
    await expectGrpcCode(
      () => clients.mcpServerCommand.completeOAuthConnect({ mcpServerId: "", state: "s", authorizationCode: "c" }),
      Code.InvalidArgument,
      "complete empty mcp_server_id",
    );
    await expectGrpcCode(
      () => clients.mcpServerCommand.completeOAuthConnect({ mcpServerId: "mcp_x", state: "", authorizationCode: "c" }),
      Code.InvalidArgument,
      "complete empty state",
    );
    await expectGrpcCode(
      () => clients.mcpServerCommand.completeOAuthConnect({ mcpServerId: "mcp_x", state: "s", authorizationCode: "" }),
      Code.InvalidArgument,
      "complete empty authorization_code",
    );
  });

  it("getOAuthGrantStatus rejects missing resource_id and org (InvalidArgument each)", async () => {
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

  it("disconnectOAuth rejects missing resource_id and org (InvalidArgument each)", async () => {
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

describe("McpServer OAuth conformance — grant-free reads", () => {
  it("getOAuthGrantStatus answers NO_GRANT for a server that never connected", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("nogrant"),
      discoveryUrl: mockAs.origin(),
    });

    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });

    expect(status.connected).toBe(false);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
  });

  it("disconnectOAuth is idempotent: no grant answers disconnected=false, not an error", async () => {
    const { org } = await target.provisionTenancy();
    const out = await clients.mcpServerCommand.disconnectOAuth({ resourceId: "mcp_nogrant", org });
    expect(out.disconnected).toBe(false);
  });
});

// The hosted BYOA lane: on OSS all three RPCs answer UNIMPLEMENTED by design,
// as ONE capability — the SDK probes getOrgOAuthApp and gates its BYOA UI on
// the answer (stigmer#558). Where the capability exists (cloud), these pins
// gate off; the lane's real behavior needs a vendor OAuth app no hermetic
// target can provision and stays with cloud's own integration tests.
describe.skipIf(orgOAuthAppConfigured)(
  "McpServer OAuth conformance — org OAuth app pins (OSS refusals)",
  () => {
    it("getOrgOAuthApp answers Unimplemented", async () => {
      const { org } = await target.provisionTenancy();
      await expectGrpcCode(
        () => clients.mcpServerQuery.getOrgOAuthApp({ resourceId: "mcp_x", org }),
        Code.Unimplemented,
        "getOrgOAuthApp on OSS",
      );
    });

    it("setOrgOAuthApp answers Unimplemented", async () => {
      const { org } = await target.provisionTenancy();
      await expectGrpcCode(
        () =>
          clients.mcpServerCommand.setOrgOAuthApp({
            resourceId: "mcp_x",
            org,
            clientId: "byoa-client",
            clientSecret: "byoa-secret",
          }),
        Code.Unimplemented,
        "setOrgOAuthApp on OSS",
      );
    });

    it("deleteOrgOAuthApp answers Unimplemented", async () => {
      const { org } = await target.provisionTenancy();
      await expectGrpcCode(
        () => clients.mcpServerCommand.deleteOrgOAuthApp({ resourceId: "mcp_x", org }),
        Code.Unimplemented,
        "deleteOrgOAuthApp on OSS",
      );
    });
  },
);
