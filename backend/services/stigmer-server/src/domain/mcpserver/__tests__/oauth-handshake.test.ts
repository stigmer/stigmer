/**
 * Pins the OAuth handshake against Go's initiate_oauth_connect.go +
 * complete_oauth_connect.go + disconnect_oauth.go +
 * get_oauth_grant_status.go (initiate_vendor_refusal_test.go +
 * oauth_connect_secrets_test.go coverage) — through the REAL stack: a
 * composed server on an ephemeral port, a native gRPC client, a live
 * mock authorization server (RFC 8414 discovery + RFC 7591 DCR +
 * authorize pre-flight + token endpoint), and the real environment
 * domain behind the managed-env lifecycle.
 *
 * DB-1 (sub-project 20260825.02): this composed server has NO Temporal
 * behind it, and completeOAuthConnect works anyway — the ratified,
 * disclosed divergence from Go's composition gate. connect/startConnect
 * refuse with the byte-pinned engine-unavailable copy on the same boot.
 */
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import {
  TokenEndpointAuthMethod,
  VendorApprovalStatus,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const REDIRECT_URI = "http://127.0.0.1:8234/auth/oauth/callback";
const ORG = "acme";

// ---------------------------------------------------------------------------
// A minimal mock authorization server: discovery + DCR + authorize
// pre-flight + token exchange. Programmable per test via `levers`.
// ---------------------------------------------------------------------------

interface MockAsLevers {
  omitRegistrationEndpoint?: boolean;
  tokenStatus?: number;
  tokenBody?: unknown;
}

class MockAuthorizationServer {
  private server: Server | undefined;
  private baseUrl = "";
  levers: MockAsLevers = {};
  tokenRequests: URLSearchParams[] = [];

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", this.baseUrl);
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: this.baseUrl,
            authorization_endpoint: `${this.baseUrl}/authorize`,
            token_endpoint: `${this.baseUrl}/token`,
            ...(this.levers.omitRegistrationEndpoint === true
              ? {}
              : { registration_endpoint: `${this.baseUrl}/register` }),
            scopes_supported: ["read", "write"],
            code_challenge_methods_supported: ["S256"],
          }),
        );
        return;
      }
      if (url.pathname === "/register" && req.method === "POST") {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ client_id: "dcr-client-1" }));
        return;
      }
      if (url.pathname === "/authorize") {
        // The pre-flight probe: 200 = healthy login page, fail-open.
        res.writeHead(200);
        res.end("login page");
        return;
      }
      if (url.pathname === "/token" && req.method === "POST") {
        let body = "";
        req.on("data", (chunk: Buffer) => (body += chunk.toString()));
        req.on("end", () => {
          this.tokenRequests.push(new URLSearchParams(body));
          res.writeHead(this.levers.tokenStatus ?? 200, {
            "Content-Type": "application/json",
          });
          res.end(
            JSON.stringify(
              this.levers.tokenBody ?? {
                access_token: "at-fresh",
                token_type: "bearer",
                expires_in: 3600,
                refresh_token: "rt-fresh",
              },
            ),
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) =>
      this.server!.listen(0, "127.0.0.1", resolve),
    );
    const address = this.server!.address();
    if (address === null || typeof address === "string") {
      throw new Error("mock AS failed to bind");
    }
    this.baseUrl = `http://127.0.0.1:${address.port}`;
    return this.baseUrl;
  }

  reset(): void {
    this.levers = {};
    this.tokenRequests = [];
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------

type CommandClient = Client<typeof McpServerCommandController>;
type QueryClient = Client<typeof McpServerQueryController>;

let server: ComposedServer;
let command: CommandClient;
let query: QueryClient;
let mockAs: MockAuthorizationServer;
let asBaseUrl: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mcpserver-oauth-handshake-"));
  mockAs = new MockAuthorizationServer();
  asBaseUrl = await mockAs.start();
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine: 127.0.0.1:1 is deterministically closed (the composed
      // CRUD harness idiom) — which is exactly the DB-1 arm under test.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STORAGE_PATH: path.join(dir, "storage"),
      STIGMER_OAUTH_REDIRECT_URI: REDIRECT_URI,
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  command = createClient(McpServerCommandController, transport);
  query = createClient(McpServerQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  await mockAs.stop();
  rmSync(dir, { recursive: true, force: true });
});

let counter = 0;
async function applyServer(overrides?: {
  vendorSlug?: string;
  oauthOnly?: boolean;
  noAuth?: boolean;
}): Promise<string> {
  counter += 1;
  const applied = await command.apply({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata: { name: `OAuth Server ${counter}`, org: ORG },
    spec: {
      description: "handshake test server",
      serverType: {
        case: "http" as const,
        value: { url: `${asBaseUrl}/mcp` },
      },
      ...(overrides?.noAuth === true
        ? {}
        : {
            auth: {
              targetEnvVar: "EXAMPLE_TOKEN",
              ...(overrides?.vendorSlug !== undefined
                ? {
                    oauthAppRef: {
                      org: ORG,
                      slug: overrides.vendorSlug,
                      kind: ApiResourceKind.oauth_app,
                    },
                  }
                : {}),
              ...(overrides?.oauthOnly === true ? { oauthOnly: true } : {}),
            },
          }),
    },
  });
  return applied.metadata!.id;
}

async function seedOAuthApp(
  slug: string,
  approvalStatus: VendorApprovalStatus,
): Promise<void> {
  const app = create(OAuthAppSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "OAuthApp",
    metadata: { id: `oap_${slug}`, name: slug, slug, org: ORG },
    spec: {
      provider: "exampleco",
      clientId: "vendor-client-1",
      clientSecret: "vendor-secret",
      authorizationUrl: `${asBaseUrl}/authorize`,
      tokenUrl: `${asBaseUrl}/token`,
      scopes: ["vendor.read"],
      vendorApprovalStatus: approvalStatus,
      tokenEndpointAuthMethod: TokenEndpointAuthMethod.CLIENT_SECRET_POST,
    },
  });
  await server.store.saveResource(
    ApiResourceKind.oauth_app,
    app.metadata!.id,
    OAuthAppSchema,
    app,
  );
}

async function expectCode(
  promise: Promise<unknown>,
  code: Code,
  fragment: string,
): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    const connectError = ConnectError.from(error);
    expect(connectError.code).toBe(code);
    expect(connectError.rawMessage).toContain(fragment);
    return connectError;
  }
  throw new Error("expected the RPC to fail");
}

describe("engine-unavailable connect refusals (the DB-1 counterpart)", () => {
  it("connect refuses FailedPrecondition on a Temporal-less server (byte-pinned copy)", async () => {
    const id = await applyServer({ noAuth: true });
    await expectCode(
      command.connect({ mcpServerId: id, org: ORG }),
      Code.FailedPrecondition,
      "connect is not available: Temporal not configured",
    );
  });

  it("startConnect refuses identically", async () => {
    const id = await applyServer({ noAuth: true });
    await expectCode(
      command.startConnect({ mcpServerId: id, org: ORG }),
      Code.FailedPrecondition,
      "connect is not available: Temporal not configured",
    );
  });
});

describe("initiateOAuthConnect", () => {
  it("rejects an empty mcp_server_id (protovalidate answers before the handler guard — same order as Go)", async () => {
    await expectCode(
      command.initiateOAuthConnect({ mcpServerId: "", org: ORG }),
      Code.InvalidArgument,
      "mcp_server_id: value is required [required]",
    );
  });

  it("answers NotFound for an unknown server", async () => {
    await expectCode(
      command.initiateOAuthConnect({ mcpServerId: "mcps_ghost", org: ORG }),
      Code.NotFound,
      "mcp_server not found: mcps_ghost",
    );
  });

  it("refuses a server without an auth block", async () => {
    const id = await applyServer({ noAuth: true });
    await expectCode(
      command.initiateOAuthConnect({ mcpServerId: id, org: ORG }),
      Code.FailedPrecondition,
      `MCP server '${id}' does not have an auth block configured`,
    );
  });

  it("DCR arm: discovers, registers, and returns a sorted S256 authorization URL", async () => {
    mockAs.reset();
    const id = await applyServer();
    const output = await command.initiateOAuthConnect({
      mcpServerId: id,
      org: ORG,
    });

    const url = new URL(output.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(`${asBaseUrl}/authorize`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("dcr-client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBe(output.state);
    // Scope fallback to the discovered scopes_supported (space-joined).
    expect(url.searchParams.get("scope")).toBe("read write");
    // Go url.Values.Encode() sorts keys — the raw query is ordered.
    const keys = [...url.searchParams.keys()];
    expect(keys).toEqual([...keys].sort());
    expect(output.scopes).toEqual(["read", "write"]);
    expect(output.providerName).toBe(`OAuth Server ${counter}`);
  });

  it("DCR arm: refuses a provider that advertises no registration_endpoint", async () => {
    mockAs.reset();
    mockAs.levers.omitRegistrationEndpoint = true;
    const id = await applyServer();
    await expectCode(
      command.initiateOAuthConnect({ mcpServerId: id, org: ORG }),
      Code.FailedPrecondition,
      "does not advertise a registration_endpoint for DCR",
    );
    mockAs.reset();
  });

  const refusals: Array<[string, VendorApprovalStatus, boolean, string]> = [
    [
      "PENDING with the manual-token alternative",
      VendorApprovalStatus.PENDING,
      false,
      "OAuth sign-in is unavailable: the platform's OAuth app for 'exampleco' is pending approval by the vendor. Please enter a token manually instead.",
    ],
    [
      "REJECTED with the manual-token alternative",
      VendorApprovalStatus.REJECTED,
      false,
      "OAuth sign-in is unavailable: the platform's OAuth app for 'exampleco' is rejected by the vendor. Please enter a token manually instead.",
    ],
    [
      "PENDING with the oauth_only BYOA alternative (#412)",
      VendorApprovalStatus.PENDING,
      true,
      "OAuth sign-in is unavailable: the platform's OAuth app for 'exampleco' is pending approval by the vendor. This server only accepts OAuth sign-in; an org admin can configure your own OAuth app instead.",
    ],
  ];
  it.each(refusals)("vendor arm refuses %s", async (_label, status, oauthOnly, copy) => {
    const slug = `vendor-${status}-${oauthOnly ? "only" : "manual"}`;
    await seedOAuthApp(slug, status);
    const id = await applyServer({ vendorSlug: slug, oauthOnly });
    const error = await expectCode(
      command.initiateOAuthConnect({ mcpServerId: id, org: ORG }),
      Code.FailedPrecondition,
      copy,
    );
    expect(error.rawMessage).toBe(copy);
  });

  it("vendor arm answers NotFound for an unresolvable oauth_app_ref", async () => {
    const id = await applyServer({ vendorSlug: "no-such-app" });
    await expectCode(
      command.initiateOAuthConnect({ mcpServerId: id, org: ORG }),
      Code.NotFound,
      "oauth_app not found: no-such-app",
    );
  });

  it("vendor arm (APPROVED): builds the URL from the OAuthApp's endpoints and scopes", async () => {
    await seedOAuthApp("vendor-ok", VendorApprovalStatus.APPROVED);
    const id = await applyServer({ vendorSlug: "vendor-ok" });
    const output = await command.initiateOAuthConnect({
      mcpServerId: id,
      org: ORG,
    });
    const url = new URL(output.authorizationUrl);
    expect(url.searchParams.get("client_id")).toBe("vendor-client-1");
    expect(url.searchParams.get("scope")).toBe("vendor.read");
    expect(output.providerName).toBe("exampleco");
  });
});

describe("completeOAuthConnect → grant → disconnect (the full lifecycle)", () => {
  it("guards its inputs (proto rules answer first, exactly as on Go)", async () => {
    await expectCode(
      command.completeOAuthConnect({ mcpServerId: "", state: "s", authorizationCode: "c" }),
      Code.InvalidArgument,
      "mcp_server_id: value is required [required]",
    );
    await expectCode(
      command.completeOAuthConnect({ mcpServerId: "m", state: "", authorizationCode: "c" }),
      Code.InvalidArgument,
      "state:",
    );
    await expectCode(
      command.completeOAuthConnect({ mcpServerId: "m", state: "s", authorizationCode: "" }),
      Code.InvalidArgument,
      "authorization_code:",
    );
  });

  it("refuses an unknown or already-consumed state (single-use atomicity)", async () => {
    await expectCode(
      command.completeOAuthConnect({
        mcpServerId: "mcps_x",
        state: "never-issued",
        authorizationCode: "c",
      }),
      Code.FailedPrecondition,
      "no pending OAuth state found for the given state parameter (expired or already used)",
    );
  });

  it("refuses a state minted for a different server", async () => {
    mockAs.reset();
    const id = await applyServer();
    const initiated = await command.initiateOAuthConnect({
      mcpServerId: id,
      org: ORG,
    });
    await expectCode(
      command.completeOAuthConnect({
        mcpServerId: "mcps_other",
        state: initiated.state,
        authorizationCode: "c",
      }),
      Code.FailedPrecondition,
      "state parameter does not match the requested mcp_server_id",
    );
  });

  it("maps a token-exchange failure to Unavailable (the pinned mapping)", async () => {
    mockAs.reset();
    const id = await applyServer();
    const initiated = await command.initiateOAuthConnect({
      mcpServerId: id,
      org: ORG,
    });
    mockAs.levers.tokenStatus = 400;
    mockAs.levers.tokenBody = { error: "invalid_grant" };
    await expectCode(
      command.completeOAuthConnect({
        mcpServerId: id,
        state: initiated.state,
        authorizationCode: "bad-code",
      }),
      Code.Unavailable,
      "token exchange failed:",
    );
    mockAs.reset();
  });

  it("exchanges the code, stores tokens in a managed environment, grants, reuses on re-connect, disconnects", async () => {
    mockAs.reset();
    const id = await applyServer();

    // First connect.
    const initiated = await command.initiateOAuthConnect({
      mcpServerId: id,
      org: ORG,
    });
    const completed = await command.completeOAuthConnect({
      mcpServerId: id,
      state: initiated.state,
      authorizationCode: "auth-code-1",
    });
    expect(completed.connected).toBe(true);
    expect(completed.targetEnvVar).toBe("EXAMPLE_TOKEN");

    // The exchange presented the DCR public client with PKCE (no secret).
    const tokenRequest = mockAs.tokenRequests[0];
    expect(tokenRequest?.get("grant_type")).toBe("authorization_code");
    expect(tokenRequest?.get("client_id")).toBe("dcr-client-1");
    expect(tokenRequest?.get("redirect_uri")).toBe(REDIRECT_URI);
    expect(tokenRequest?.get("code_verifier")).toBeTruthy();
    expect(tokenRequest?.has("client_secret")).toBe(false);

    // The grant is queryable and HEALTHY; the refresh-token env var is
    // stamped unconditionally (oss#863's precondition, ported as-is).
    const status = await query.getOAuthGrantStatus({ resourceId: id, org: ORG });
    expect(status.connected).toBe(true);
    expect(status.targetEnvVar).toBe("EXAMPLE_TOKEN");
    expect(status.authMethod).toBe("mcp_oauth");
    expect(status.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
    );

    const grant = await server.store.oauthGrants.find("", id, ORG);
    expect(grant?.refreshTokenEnvVar).toBe("EXAMPLE_TOKEN_REFRESH_TOKEN");
    const firstEnvId = grant?.environmentId ?? "";
    expect(firstEnvId).not.toBe("");

    // Re-connect reuses the managed environment.
    const again = await command.initiateOAuthConnect({ mcpServerId: id, org: ORG });
    await command.completeOAuthConnect({
      mcpServerId: id,
      state: again.state,
      authorizationCode: "auth-code-2",
    });
    const regrant = await server.store.oauthGrants.find("", id, ORG);
    expect(regrant?.environmentId).toBe(firstEnvId);

    // Disconnect tears down grant + environment; a second disconnect is
    // the idempotent no-grant arm.
    const disconnected = await command.disconnectOAuth({ resourceId: id, org: ORG });
    expect(disconnected.disconnected).toBe(true);
    expect(await server.store.oauthGrants.find("", id, ORG)).toBeUndefined();
    const againDisconnected = await command.disconnectOAuth({
      resourceId: id,
      org: ORG,
    });
    expect(againDisconnected.disconnected).toBe(false);

    // NO_GRANT after teardown.
    const after = await query.getOAuthGrantStatus({ resourceId: id, org: ORG });
    expect(after.connected).toBe(false);
    expect(after.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    );
  });

  it("refuses a REPLAYED state after a successful complete (single-use atomicity at the wire)", async () => {
    mockAs.reset();
    const id = await applyServer();
    const initiated = await command.initiateOAuthConnect({
      mcpServerId: id,
      org: ORG,
    });
    await command.completeOAuthConnect({
      mcpServerId: id,
      state: initiated.state,
      authorizationCode: "auth-code-replay-1",
    });
    await expectCode(
      command.completeOAuthConnect({
        mcpServerId: id,
        state: initiated.state,
        authorizationCode: "auth-code-replay-2",
      }),
      Code.FailedPrecondition,
      "no pending OAuth state found for the given state parameter (expired or already used)",
    );
  });
});

describe("getOAuthGrantStatus", () => {
  it("guards its inputs (proto rules answer first, exactly as on Go)", async () => {
    await expectCode(
      query.getOAuthGrantStatus({ resourceId: "", org: ORG }),
      Code.InvalidArgument,
      "resource_id: value is required [required]",
    );
    await expectCode(
      query.getOAuthGrantStatus({ resourceId: "x", org: "" }),
      Code.InvalidArgument,
      "org:",
    );
  });

  it("claims TOKEN_EXPIRED_REFRESHABLE for an expired grant with a stamped refresh var — oss#863, pinned as-is", async () => {
    await server.store.oauthGrants.upsert({
      identityAccountId: "",
      resourceId: "mcps_expired",
      resourceKind: "mcp_server",
      orgId: ORG,
      // Expired well past the 60s buffer.
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 3600,
      clientId: "c",
      authMethod: "mcp_oauth",
      tokenEndpoint: `${asBaseUrl}/token`,
      accessTokenEnvVar: "T",
      // Stamped unconditionally by complete — even when no refresh token
      // was ever issued, which is exactly the filed defect.
      refreshTokenEnvVar: "T_REFRESH_TOKEN",
      environmentId: "env_x",
      createdAt: 0,
      updatedAt: 0,
    });
    const status = await query.getOAuthGrantStatus({
      resourceId: "mcps_expired",
      org: ORG,
    });
    expect(status.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE,
    );
  });

  it("answers TOKEN_EXPIRED only for a grant WITHOUT a refresh var — unreachable through the real flow (oss#863)", async () => {
    await server.store.oauthGrants.upsert({
      identityAccountId: "",
      resourceId: "mcps_expired_norefresh",
      resourceKind: "mcp_server",
      orgId: ORG,
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 3600,
      clientId: "c",
      authMethod: "mcp_oauth",
      tokenEndpoint: `${asBaseUrl}/token`,
      accessTokenEnvVar: "T",
      refreshTokenEnvVar: "",
      environmentId: "env_x",
      createdAt: 0,
      updatedAt: 0,
    });
    const status = await query.getOAuthGrantStatus({
      resourceId: "mcps_expired_norefresh",
      org: ORG,
    });
    expect(status.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED,
    );
  });
});
