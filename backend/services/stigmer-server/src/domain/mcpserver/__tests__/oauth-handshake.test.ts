/**
 * Pins the OAuth handshake against Go's initiate_oauth_connect.go +
 * complete_oauth_connect.go + disconnect_oauth.go +
 * get_oauth_grant_status.go (initiate_vendor_refusal_test.go +
 * oauth_connect_secrets_test.go coverage) — through the REAL stack: a
 * composed server on an ephemeral port, a native gRPC client, a live
 * mock authorization server (RFC 8414 discovery + RFC 7591 DCR +
 * authorize pre-flight + token endpoint), and the real credential domain
 * behind the sign-in (domain/credential/sign-in.ts).
 *
 * What a completed sign-in leaves behind: a credential of the person who
 * signed in (or of the organization, for a server with organization
 * sign-in), serving the server, with one field named by the server's
 * target_env_var and its access token sealed; and a grant keyed by that
 * person's identity ("" for the organization's), naming the credential,
 * with the refresh token sealed on it. A re-connect reuses the grant's
 * credential; disconnect deletes the credential and the grant; deleting
 * the credential ends its grant.
 *
 * Whose sign-in each lane acts on is proven on a second boot with the
 * built-in authorizer and two people (the founder, an admin, and a
 * member): two members' personal sign-ins to one server coexist, and each
 * one's status and disconnect touch only their own; a pending sign-in is
 * completed only by the person who started it; an organization sign-in
 * is keyed by "" and refused to a non-admin at initiate, complete and
 * disconnect.
 *
 * This composed server has NO Temporal behind it, and completeOAuthConnect
 * works anyway — a deliberate divergence from Go's composition gate.
 * connect/startConnect
 * refuse with the byte-pinned engine-unavailable copy on the same boot.
 *
 * Keys are injected via env (vi.stubEnv) so the key ladder short-circuits
 * before its file steps.
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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialQueryController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/query_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerCommandController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/command_pb";
import { McpServerQueryController } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/query_pb";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import {
  TokenEndpointAuthMethod,
  VendorApprovalStatus,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  EncryptionScope,
  SecretService,
  isCiphertextShaped,
} from "../../../encryption/encryption.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { SYSTEM_OPERATOR_IDENTITY_ID } from "../../../pipeline/interceptors/auth.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const REDIRECT_URI = "http://127.0.0.1:8234/auth/oauth/callback";
const ORG = "acme";
/** The trusted-local operator (no operator email installed): every request on the first boot is theirs. */
const OPERATOR = SYSTEM_OPERATOR_IDENTITY_ID;
const ENCRYPTION_KEY = Buffer.alloc(32, 7);
/** Opens what the composed server sealed: the same key, read the same way. */
const opener = SecretService.create(ENCRYPTION_KEY);
// The id the server mints for ORG: rows written straight to the store and
// grants read from it name the organization by id; requests use the slug.
let ORG_ID: string;

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
let credentials: Client<typeof CredentialCommandController>;
let credentialQuery: Client<typeof CredentialQueryController>;
let mockAs: MockAuthorizationServer;
let asBaseUrl: string;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "mcpserver-oauth-handshake-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", ENCRYPTION_KEY.toString("base64"));
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
  mockAs = new MockAuthorizationServer();
  asBaseUrl = await mockAs.start();
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine: 127.0.0.1:1 is deterministically closed (the composed
      // CRUD harness idiom) — which is exactly the Temporal-less arm under
      // test.
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
  const organizations = await seedOrganizations(transport, [ORG]);
  ORG_ID = organizationId(organizations, ORG);
  command = createClient(McpServerCommandController, transport);
  query = createClient(McpServerQueryController, transport);
  credentials = createClient(CredentialCommandController, transport);
  credentialQuery = createClient(CredentialQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  await mockAs.stop();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

let counter = 0;
async function applyServer(overrides?: {
  vendorSlug?: string;
  oauthOnly?: boolean;
  noAuth?: boolean;
  /** A name of the caller's own, with an explicit slug beside it. */
  longName?: string;
}): Promise<string> {
  counter += 1;
  const applied = await command.apply({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata:
      overrides?.longName !== undefined
        ? { name: overrides.longName, slug: `oauth-long-${counter}`, org: ORG }
        : { name: `OAuth Server ${counter}`, org: ORG },
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
    metadata: { id: `oap_${slug}`, name: slug, slug, org: ORG_ID },
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

/** A credential as it rests in the store, secrets sealed. */
function storedCredential(credentialId: string) {
  return server.store.getResource(
    ApiResourceKind.credential,
    credentialId,
    CredentialSchema,
  );
}

describe("engine-unavailable connect refusals (the Temporal-less counterpart)", () => {
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
      "does not advertise a registration_endpoint for DCR: 127.0.0.1:",
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
  it.each(refusals)(
    "vendor arm refuses %s",
    async (_label, status, oauthOnly, copy) => {
      const slug = `vendor-${status}-${oauthOnly ? "only" : "manual"}`;
      await seedOAuthApp(slug, status);
      const id = await applyServer({ vendorSlug: slug, oauthOnly });
      const error = await expectCode(
        command.initiateOAuthConnect({ mcpServerId: id, org: ORG }),
        Code.FailedPrecondition,
        copy,
      );
      expect(error.rawMessage).toBe(copy);
    },
  );

  it("vendor arm answers NotFound for an unresolvable oauth_app_ref", async () => {
    // The app must exist when the server is written (the reference rule);
    // the reference becomes unresolvable when its target leaves afterwards.
    await seedOAuthApp("no-such-app", VendorApprovalStatus.APPROVED);
    const id = await applyServer({ vendorSlug: "no-such-app" });
    await server.store.deleteResource(
      ApiResourceKind.oauth_app,
      "oap_no-such-app",
    );
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
      command.completeOAuthConnect({
        mcpServerId: "",
        state: "s",
        authorizationCode: "c",
      }),
      Code.InvalidArgument,
      "mcp_server_id: value is required [required]",
    );
    await expectCode(
      command.completeOAuthConnect({
        mcpServerId: "m",
        state: "",
        authorizationCode: "c",
      }),
      Code.InvalidArgument,
      "state:",
    );
    await expectCode(
      command.completeOAuthConnect({
        mcpServerId: "m",
        state: "s",
        authorizationCode: "",
      }),
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

  it("exchanges the code, saves the sign-in as the caller's credential, seals the refresh token on the grant, reuses it on re-connect, disconnects", async () => {
    mockAs.reset();
    const id = await applyServer();
    const mcp = await server.store.getResource(ApiResourceKind.mcp_server, id, McpServerSchema);

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

    // The grant is queryable and HEALTHY.
    const status = await query.getOAuthGrantStatus({
      resourceId: id,
      org: ORG,
    });
    expect(status.connected).toBe(true);
    expect(status.targetEnvVar).toBe("EXAMPLE_TOKEN");
    expect(status.authMethod).toBe("mcp_oauth");
    expect(status.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY,
    );

    // A personal sign-in: the grant is the caller's, never the
    // organization's, and the refresh token rests sealed on it.
    expect(await server.store.oauthGrants.find("", id, ORG_ID)).toBeUndefined();
    const grant = await server.store.oauthGrants.find(OPERATOR, id, ORG_ID);
    expect(grant?.accessTokenEnvVar).toBe("EXAMPLE_TOKEN");
    const sealedRefresh = grant?.refreshToken ?? "";
    expect(isCiphertextShaped(sealedRefresh)).toBe(true);
    expect(sealedRefresh).not.toContain("rt-fresh");
    expect(await opener.decrypt(sealedRefresh)).toBe("rt-fresh");
    const credentialId = grant?.credentialId ?? "";
    expect(credentialId).not.toBe("");

    // The credential: the caller's own sign-in, serving the server, one
    // field named target_env_var holding the sealed access token.
    const saved = await storedCredential(credentialId);
    expect(saved.spec?.owner).toEqual({ case: "person", value: OPERATOR });
    expect(saved.status?.source).toBe(CredentialSource.oauth);
    expect(saved.metadata?.org).toBe(ORG_ID);
    expect(saved.metadata?.name).toBe(mcp.metadata?.name);
    expect(Object.keys(saved.spec?.fields ?? {})).toEqual(["EXAMPLE_TOKEN"]);
    const field = saved.spec?.fields["EXAMPLE_TOKEN"];
    expect(field?.plain).toBe(false);
    expect(isCiphertextShaped(field?.value ?? "")).toBe(true);
    expect(await opener.decrypt(field?.value ?? "")).toBe("at-fresh");
    expect(saved.spec?.serves).toHaveLength(1);
    const served = saved.spec?.serves[0]?.target;
    expect(served?.case).toBe("mcpServer");
    expect(served?.case === "mcpServer" ? served.value.slug : "").toBe(mcp.metadata?.slug);
    expect(served?.case === "mcpServer" ? served.value.org : "").toBe(ORG_ID);

    // The person reveals their own sign-in's token on the wire.
    const revealed = await credentialQuery.revealField({
      credentialId,
      field: "EXAMPLE_TOKEN",
    });
    expect(revealed.value).toBe("at-fresh");

    // Re-connect reuses the grant's credential; the token is replaced.
    mockAs.levers.tokenBody = {
      access_token: "at-second",
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: "rt-second",
    };
    const again = await command.initiateOAuthConnect({
      mcpServerId: id,
      org: ORG,
    });
    await command.completeOAuthConnect({
      mcpServerId: id,
      state: again.state,
      authorizationCode: "auth-code-2",
    });
    const regrant = await server.store.oauthGrants.find(OPERATOR, id, ORG_ID);
    expect(regrant?.credentialId).toBe(credentialId);
    expect(await opener.decrypt(regrant?.refreshToken ?? "")).toBe("rt-second");
    const reconnected = await credentialQuery.revealField({
      credentialId,
      field: "EXAMPLE_TOKEN",
    });
    expect(reconnected.value).toBe("at-second");
    mockAs.reset();

    // Disconnect deletes the credential and the grant; a second
    // disconnect is the idempotent no-grant arm.
    const disconnected = await command.disconnectOAuth({
      resourceId: id,
      org: ORG,
    });
    expect(disconnected.disconnected).toBe(true);
    expect(await server.store.oauthGrants.find(OPERATOR, id, ORG_ID)).toBeUndefined();
    await expect(storedCredential(credentialId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
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

  it("deleting the sign-in's credential ends its grant", async () => {
    mockAs.reset();
    const id = await applyServer();
    const initiated = await command.initiateOAuthConnect({ mcpServerId: id, org: ORG });
    await command.completeOAuthConnect({
      mcpServerId: id,
      state: initiated.state,
      authorizationCode: "auth-code-delete",
    });
    const grant = await server.store.oauthGrants.find(OPERATOR, id, ORG_ID);
    const credentialId = grant?.credentialId ?? "";
    expect(credentialId).not.toBe("");

    await credentials.delete({ resourceId: credentialId });

    expect(await server.store.oauthGrants.find(OPERATOR, id, ORG_ID)).toBeUndefined();
    const status = await query.getOAuthGrantStatus({ resourceId: id, org: ORG });
    expect(status.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    );
  });

  it("keeps no refresh token on the grant when the vendor issues none", async () => {
    mockAs.reset();
    mockAs.levers.tokenBody = { access_token: "at-only", token_type: "bearer", expires_in: 3600 };
    const id = await applyServer();
    const initiated = await command.initiateOAuthConnect({ mcpServerId: id, org: ORG });
    await command.completeOAuthConnect({
      mcpServerId: id,
      state: initiated.state,
      authorizationCode: "auth-code-no-refresh",
    });
    mockAs.reset();
    const grant = await server.store.oauthGrants.find(OPERATOR, id, ORG_ID);
    expect(grant?.refreshToken).toBe("");
    expect(grant?.credentialId ?? "").not.toBe("");
  });

  it("saves the sign-in for an MCP server whose name is too long for a slug, in a credential whose slug is fitted", async () => {
    mockAs.reset();
    // Valid as the caller wrote it (a 120-character name beside an explicit
    // slug); the credential named after it must still have a slug that fits.
    const longName = `Customer Support Knowledge Base ${"x".repeat(88)}`;
    const id = await applyServer({ longName });
    const initiated = await command.initiateOAuthConnect({ mcpServerId: id, org: ORG });
    const completed = await command.completeOAuthConnect({
      mcpServerId: id,
      state: initiated.state,
      authorizationCode: "auth-code-long",
    });
    expect(completed.connected).toBe(true);
    const grant = await server.store.oauthGrants.find(OPERATOR, id, ORG_ID);
    const saved = await storedCredential(grant?.credentialId ?? "");
    expect(saved.metadata?.name).toBe(longName);
    const slug = saved.metadata?.slug ?? "";
    expect(slug.length).toBeGreaterThan(0);
    expect(slug.length).toBeLessThanOrEqual(63);
    expect(slug).toMatch(/-[0-9a-f]{8}$/);
  });

  it("saves the sign-in for an MCP server whose name is at the name's bound, in a credential whose name is the same", async () => {
    mockAs.reset();
    // 200 characters, the most a name holds.
    const longName = `Customer Support ${"y".repeat(183)}`;
    const id = await applyServer({ longName });
    const initiated = await command.initiateOAuthConnect({ mcpServerId: id, org: ORG });
    const completed = await command.completeOAuthConnect({
      mcpServerId: id,
      state: initiated.state,
      authorizationCode: "auth-code-at-bound",
    });
    expect(completed.connected).toBe(true);
    const grant = await server.store.oauthGrants.find(OPERATOR, id, ORG_ID);
    const saved = await storedCredential(grant?.credentialId ?? "");
    expect(Array.from(saved.metadata?.name ?? "")).toHaveLength(200);
    expect(saved.metadata?.name).toBe(longName);
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

  it("answers TOKEN_EXPIRED_REFRESHABLE for an expired grant holding a sealed refresh token", async () => {
    await server.store.oauthGrants.upsert({
      identityAccountId: OPERATOR,
      resourceId: "mcps_expired",
      resourceKind: "mcp_server",
      orgId: ORG_ID,
      // Expired well past the 60s buffer.
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 3600,
      clientId: "c",
      authMethod: "mcp_oauth",
      tokenEndpoint: `${asBaseUrl}/token`,
      accessTokenEnvVar: "T",
      credentialId: "cred_x",
      refreshToken: await opener.encrypt(
        "rt-held",
        EncryptionScope.forOrganization(ORG_ID),
      ),
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

  it("answers TOKEN_EXPIRED for an expired grant the vendor issued no refresh token for", async () => {
    await server.store.oauthGrants.upsert({
      identityAccountId: OPERATOR,
      resourceId: "mcps_expired_norefresh",
      resourceKind: "mcp_server",
      orgId: ORG_ID,
      accessTokenExpiresAt: Math.floor(Date.now() / 1000) - 3600,
      clientId: "c",
      authMethod: "mcp_oauth",
      tokenEndpoint: `${asBaseUrl}/token`,
      accessTokenEnvVar: "T",
      credentialId: "cred_x",
      refreshToken: "",
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

  it("reads the caller's own grant: another person's grant for the server is not the caller's status", async () => {
    await server.store.oauthGrants.upsert({
      identityAccountId: "someone-else",
      resourceId: "mcps_someone_elses",
      resourceKind: "mcp_server",
      orgId: ORG_ID,
      accessTokenExpiresAt: 0,
      clientId: "c",
      authMethod: "mcp_oauth",
      tokenEndpoint: `${asBaseUrl}/token`,
      accessTokenEnvVar: "T",
      credentialId: "cred_y",
      refreshToken: "",
      createdAt: 0,
      updatedAt: 0,
    });
    const status = await query.getOAuthGrantStatus({
      resourceId: "mcps_someone_elses",
      org: ORG,
    });
    expect(status.connected).toBe(false);
    expect(status.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    );
  });
});

// ---------------------------------------------------------------------------
// Whose sign-in: a boot with the built-in authorizer and two people.
// ---------------------------------------------------------------------------

describe("whose sign-in each lane acts on (built-in authorizer, two people)", () => {
  /** The organization's founder: its owner, so one of its admins. */
  const FOUNDER = "fake|signin-founder";
  /** Provisioned after the organization exists: a member, not an admin. */
  const MEMBER = "fake|signin-member";
  const SIGN_IN_ORG = "signin-org";
  let builtInDir: string;
  let builtIn: ComposedServer;
  let builtInPort: number;
  let signInOrgId: string;

  const asFounder = () =>
    transportFor(builtInPort, fakeJwt(FOUNDER, "founder@example.com"));
  const asMember = () =>
    transportFor(builtInPort, fakeJwt(MEMBER, "member@example.com"));
  const mcpCommand = (transport: Transport) =>
    createClient(McpServerCommandController, transport);
  const mcpQuery = (transport: Transport) =>
    createClient(McpServerQueryController, transport);

  beforeAll(async () => {
    builtInDir = mkdtempSync(path.join(tmpdir(), "mcpserver-oauth-sign-in-"));
    // The unit vouches for tokens and declares the posture and registers
    // no Authorizer: open source composes the built-in one.
    const unit: ServerExtension = {
      name: "fake-oidc-only",
      requireAuthentication: true,
      identityVerifiers: [fakeVerifier],
    };
    builtIn = await composeServer({
      config: loadConfig({
        ...baseConfig(builtInDir),
        STIGMER_OAUTH_REDIRECT_URI: REDIRECT_URI,
      }),
      logger: silentLogger,
      extensions: [unit],
      portOverride: 0,
      host: "127.0.0.1",
    });
    builtInPort = await builtIn.start();
    await createClient(IdentityAccountCommandController, asFounder()).provisionMyAccount({});
    signInOrgId =
      (
        await createClient(OrganizationCommandController, asFounder()).create({
          apiVersion: "tenancy.stigmer.ai/v1",
          kind: "Organization",
          metadata: { name: SIGN_IN_ORG, slug: SIGN_IN_ORG, org: "" },
          spec: { description: SIGN_IN_ORG },
        })
      ).metadata?.id ?? "";
    await createClient(IdentityAccountCommandController, asMember()).provisionMyAccount({});
  });

  afterAll(async () => {
    await builtIn.shutdown();
    rmSync(builtInDir, { recursive: true, force: true });
  });

  let builtInCounter = 0;
  /** An org-visible server the founder writes, every member's to connect. */
  async function founderServer(signIn: McpServerSignIn): Promise<McpServer> {
    builtInCounter += 1;
    return mcpCommand(asFounder()).apply({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "McpServer",
      metadata: {
        name: `Sign-in Server ${builtInCounter}`,
        org: SIGN_IN_ORG,
        visibility: ApiResourceVisibility.visibility_org,
      },
      spec: {
        description: "sign-in test server",
        serverType: { case: "http" as const, value: { url: `${asBaseUrl}/mcp` } },
        auth: { targetEnvVar: "EXAMPLE_TOKEN" },
        signIn,
      },
    });
  }

  async function signIn(transport: Transport, id: string, code: string): Promise<void> {
    const initiated = await mcpCommand(transport).initiateOAuthConnect({
      mcpServerId: id,
      org: SIGN_IN_ORG,
    });
    const completed = await mcpCommand(transport).completeOAuthConnect({
      mcpServerId: id,
      state: initiated.state,
      authorizationCode: code,
    });
    expect(completed.connected).toBe(true);
  }

  function credentialOf(credentialId: string) {
    return builtIn.store.getResource(
      ApiResourceKind.credential,
      credentialId,
      CredentialSchema,
    );
  }

  it("two members' personal sign-ins to one server coexist, and each one's status and disconnect touch only their own", async () => {
    mockAs.reset();
    const mcp = await founderServer(McpServerSignIn.personal);
    const id = mcp.metadata!.id;
    await signIn(asFounder(), id, "founder-code");
    await signIn(asMember(), id, "member-code");

    const founderGrant = await builtIn.store.oauthGrants.find(FOUNDER, id, signInOrgId);
    const memberGrant = await builtIn.store.oauthGrants.find(MEMBER, id, signInOrgId);
    expect(founderGrant?.credentialId ?? "").not.toBe("");
    expect(memberGrant?.credentialId ?? "").not.toBe("");
    expect(memberGrant?.credentialId).not.toBe(founderGrant?.credentialId);
    // A personal server never has the organization's sign-in.
    expect(await builtIn.store.oauthGrants.find("", id, signInOrgId)).toBeUndefined();
    expect((await credentialOf(founderGrant!.credentialId)).spec?.owner).toEqual({
      case: "person",
      value: FOUNDER,
    });
    expect((await credentialOf(memberGrant!.credentialId)).spec?.owner).toEqual({
      case: "person",
      value: MEMBER,
    });

    for (const transport of [asFounder(), asMember()]) {
      const status = await mcpQuery(transport).getOAuthGrantStatus({
        resourceId: id,
        org: SIGN_IN_ORG,
      });
      expect(status.connected).toBe(true);
    }

    // The member signs out: their grant and credential go; the founder's stay.
    const out = await mcpCommand(asMember()).disconnectOAuth({
      resourceId: id,
      org: SIGN_IN_ORG,
    });
    expect(out.disconnected).toBe(true);
    expect(await builtIn.store.oauthGrants.find(MEMBER, id, signInOrgId)).toBeUndefined();
    await expect(credentialOf(memberGrant!.credentialId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    const kept = await builtIn.store.oauthGrants.find(FOUNDER, id, signInOrgId);
    expect(kept?.credentialId).toBe(founderGrant?.credentialId);
    expect((await credentialOf(founderGrant!.credentialId)).metadata?.id).toBe(
      founderGrant?.credentialId,
    );
    const memberStatus = await mcpQuery(asMember()).getOAuthGrantStatus({
      resourceId: id,
      org: SIGN_IN_ORG,
    });
    expect(memberStatus.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    );
    const founderStatus = await mcpQuery(asFounder()).getOAuthGrantStatus({
      resourceId: id,
      org: SIGN_IN_ORG,
    });
    expect(founderStatus.connected).toBe(true);
  });

  it("a pending personal sign-in is completed only by the person who started it", async () => {
    mockAs.reset();
    const mcp = await founderServer(McpServerSignIn.personal);
    const id = mcp.metadata!.id;
    const initiated = await mcpCommand(asFounder()).initiateOAuthConnect({
      mcpServerId: id,
      org: SIGN_IN_ORG,
    });
    const error = await expectCode(
      mcpCommand(asMember()).completeOAuthConnect({
        mcpServerId: id,
        state: initiated.state,
        authorizationCode: "stolen-code",
      }),
      Code.FailedPrecondition,
      "this sign-in was started by another person; start your own sign-in from the MCP server's page",
    );
    expect(error.rawMessage).toBe(
      "this sign-in was started by another person; start your own sign-in from the MCP server's page",
    );
    // Refused before the code was exchanged; nobody's sign-in was saved.
    expect(mockAs.tokenRequests).toHaveLength(0);
    expect(await builtIn.store.oauthGrants.find(MEMBER, id, signInOrgId)).toBeUndefined();
    expect(await builtIn.store.oauthGrants.find(FOUNDER, id, signInOrgId)).toBeUndefined();
  });

  it("an organization sign-in is keyed by \"\", the organization's credential, and refused to a non-admin at initiate, complete and disconnect", async () => {
    mockAs.reset();
    const mcp = await founderServer(McpServerSignIn.organization);
    const id = mcp.metadata!.id;
    const slug = mcp.metadata!.slug;
    const adminsOnly = `MCP server '${slug}' uses the organization's sign-in; only the organization's admins sign it in or out`;

    // Initiate: a member may not start the organization's sign-in.
    const initiateRefusal = await expectCode(
      mcpCommand(asMember()).initiateOAuthConnect({ mcpServerId: id, org: SIGN_IN_ORG }),
      Code.PermissionDenied,
      adminsOnly,
    );
    expect(initiateRefusal.rawMessage).toBe(adminsOnly);

    // Complete: a member may not finish one an admin started.
    const started = await mcpCommand(asFounder()).initiateOAuthConnect({
      mcpServerId: id,
      org: SIGN_IN_ORG,
    });
    const completeRefusal = await expectCode(
      mcpCommand(asMember()).completeOAuthConnect({
        mcpServerId: id,
        state: started.state,
        authorizationCode: "member-code",
      }),
      Code.PermissionDenied,
      adminsOnly,
    );
    expect(completeRefusal.rawMessage).toBe(adminsOnly);
    expect(await builtIn.store.oauthGrants.find("", id, signInOrgId)).toBeUndefined();
    expect(await builtIn.store.oauthGrants.find(MEMBER, id, signInOrgId)).toBeUndefined();

    // The admin signs the organization in: the grant's identity is "",
    // the credential is the organization's.
    await signIn(asFounder(), id, "admin-code");
    const grant = await builtIn.store.oauthGrants.find("", id, signInOrgId);
    expect(grant?.credentialId ?? "").not.toBe("");
    expect(await builtIn.store.oauthGrants.find(FOUNDER, id, signInOrgId)).toBeUndefined();
    const saved = await credentialOf(grant!.credentialId);
    expect(saved.spec?.owner).toEqual({ case: "org", value: signInOrgId });
    expect(saved.status?.source).toBe(CredentialSource.oauth);
    expect(Object.keys(saved.spec?.fields ?? {})).toEqual(["EXAMPLE_TOKEN"]);

    // Every member's status reads the organization's one sign-in.
    const memberStatus = await mcpQuery(asMember()).getOAuthGrantStatus({
      resourceId: id,
      org: SIGN_IN_ORG,
    });
    expect(memberStatus.connected).toBe(true);

    // Disconnect: a member may not sign the organization out.
    const disconnectRefusal = await expectCode(
      mcpCommand(asMember()).disconnectOAuth({ resourceId: id, org: SIGN_IN_ORG }),
      Code.PermissionDenied,
      adminsOnly,
    );
    expect(disconnectRefusal.rawMessage).toBe(adminsOnly);
    expect((await builtIn.store.oauthGrants.find("", id, signInOrgId))?.credentialId).toBe(
      grant?.credentialId,
    );

    // The admin may: the credential and the grant go.
    const out = await mcpCommand(asFounder()).disconnectOAuth({
      resourceId: id,
      org: SIGN_IN_ORG,
    });
    expect(out.disconnected).toBe(true);
    expect(await builtIn.store.oauthGrants.find("", id, signInOrgId)).toBeUndefined();
    await expect(credentialOf(grant!.credentialId)).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
  });
});
