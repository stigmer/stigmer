// Conformance suite for the McpServer connect lanes and the engine-backed
// half of the OAuth handshake (Class B).
// Domain: agentic / mcpserver — the connect/OAuth facet, engine-backed half.
//
// Two facets share this file because they share one dependency: the Temporal
// engine the execution target provisions.
//
// 1. connect / startConnect — tool discovery through the runner's connect
//    workflow against the McpToolFixture, including the deterministic
//    workflow-ID attach semantics (one discovery run shared by concurrent
//    connects) and the refresh-on-connect OAuth pre-flight.
// 2. completeOAuthConnect / getOAuthGrantStatus / disconnectOAuth happy paths
//    — conceptually Temporal-free, but the server wires the sign-in lane with
//    its connect dependencies, which the Temporal-less local target does not
//    compose, so complete refuses there before validating input. The initiate
//    lanes and Layer-1 guards (genuinely engine-free) live in
//    suites/mcpserver-oauth.conformance.test.ts; everything that completes a
//    sign-in runs here. (The wiring gap is disclosed, not pinned: pinning it
//    would force a server to reproduce a composition artifact.)
//
// A completed sign-in IS a Credential of the person who signed in: `oauth`
// source, serving the server, one secret field named by the server's
// `target_env_var` holding the access token. Its fields are the platform's
// (the refresh lane rewrites them): a person may rename it or read it back,
// never set or remove a field. Signing out deletes it, and deleting it signs
// out. A connect of a server that declares a required key resolves that key
// through the same rule a run does, with the connecting person as the run's
// person: their own credential serving the server, or runtime_env.
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
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialFieldSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/spec_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { OAuthConnectionHealth } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { createHash } from "node:crypto";
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
import { HERMETIC_OAUTH_REDIRECT_URI } from "@stigmer/test-support/server-process";
import { requireLlmProxy, requireMcpFixture } from "../support/runs";
import { REDACTED_MARKER, makeCredential, mcpServerTarget, refOf } from "../support/credentials";
import {
  makeHttpMcpServer,
  makeOAuthMcpServer,
  type OAuthMcpServerOptions,
} from "../support/mcpservers";
import { makeOAuthApp, type OAuthAppOptions } from "../support/oauthapps";
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

async function createOAuthMcpServer(opts: Omit<OAuthMcpServerOptions, "targetEnvVar">) {
  const created = await clients.mcpServerCommand.create(
    makeOAuthMcpServer({ ...opts, targetEnvVar: TARGET_ENV_VAR }),
  );
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: created.metadata!.id }));
  return created;
}

// The sign-in credentials in `org` the harness's person may see.
async function signInsOf(org: string): Promise<Credential[]> {
  const listed = await clients.credentialQuery.list({ org });
  return listed.items.filter((c) => c.status?.source === CredentialSource.oauth);
}

async function createVendorOAuthApp(org: string, name: string, opts: OAuthAppOptions = {}) {
  const created = await clients.oauthAppCommand.create(
    makeOAuthApp(org, name, { tokenUrl: mockAs.tokenEndpoint(), ...opts }),
  );
  fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: created.metadata!.id }));
  return created;
}

// Runs the full DCR handshake (initiate → complete) against the mock
// authorization server. `url` optionally makes the server a real (fixture)
// HTTP MCP endpoint so a follow-up connect can discover tools.
async function completeDcrHandshake(org: string, name: string, opts: { url?: string } = {}) {
  const server = await createOAuthMcpServer({
    org,
    name,
    discoveryUrl: mockAs.origin(),
    ...(opts.url !== undefined ? { url: opts.url } : {}),
  });
  const initiated = await clients.mcpServerCommand.initiateOAuthConnect({
    mcpServerId: server.metadata!.id,
    org,
  });
  const completed = await clients.mcpServerCommand.completeOAuthConnect({
    mcpServerId: server.metadata!.id,
    state: initiated.state,
    authorizationCode: "conformance-auth-code",
  });
  return { server, initiated, completed };
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

describe("McpServer connect conformance — OAuth handshake completion", () => {
  it("[rpc:McpServerCommandController.completeOAuthConnect] refuses an unknown state parameter (FailedPrecondition, pinned copy)", async () => {
    const err = await expectGrpcCode(
      () =>
        clients.mcpServerCommand.completeOAuthConnect({
          mcpServerId: "mcp_x",
          state: "never-issued-state",
          authorizationCode: "code",
        }),
      Code.FailedPrecondition,
      "complete with unknown state",
    );
    expect(err.rawMessage).toBe(
      "no pending OAuth state found for the given state parameter (expired or already used)",
    );
  });

  it("[rpc:McpServerCommandController.completeOAuthConnect] consumes the state atomically: a second complete with the same state refuses", async () => {
    const { org } = await target.provisionTenancy();
    const { server, initiated } = await completeDcrHandshake(org, uniqueName("dcrdouble"));

    const err = await expectGrpcCode(
      () =>
        clients.mcpServerCommand.completeOAuthConnect({
          mcpServerId: server.metadata!.id,
          state: initiated.state,
          authorizationCode: "conformance-auth-code",
        }),
      Code.FailedPrecondition,
      "second complete with a consumed state",
    );
    expect(err.rawMessage).toBe(
      "no pending OAuth state found for the given state parameter (expired or already used)",
    );
  });

  it("[rpc:McpServerCommandController.completeOAuthConnect] refuses a state minted for a different server — and the mismatch consumes the state", async () => {
    const { org } = await target.provisionTenancy();
    const serverA = await createOAuthMcpServer({
      org,
      name: uniqueName("mismatchA"),
      discoveryUrl: mockAs.origin(),
    });
    const serverB = await createOAuthMcpServer({
      org,
      name: uniqueName("mismatchB"),
      discoveryUrl: mockAs.origin(),
    });
    const initiated = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: serverA.metadata!.id,
      org,
    });

    const mismatch = await expectGrpcCode(
      () =>
        clients.mcpServerCommand.completeOAuthConnect({
          mcpServerId: serverB.metadata!.id,
          state: initiated.state,
          authorizationCode: "code",
        }),
      Code.FailedPrecondition,
      "complete against the wrong server",
    );
    expect(mismatch.rawMessage).toBe("state parameter does not match the requested mcp_server_id");

    // GetAndDelete consumed the row before the mismatch check, so even the
    // RIGHT server can no longer complete with this state — the price of the
    // atomic single-use contract, pinned deliberately.
    const consumed = await expectGrpcCode(
      () =>
        clients.mcpServerCommand.completeOAuthConnect({
          mcpServerId: serverA.metadata!.id,
          state: initiated.state,
          authorizationCode: "code",
        }),
      Code.FailedPrecondition,
      "complete after a mismatch consumed the state",
    );
    expect(consumed.rawMessage).toBe(
      "no pending OAuth state found for the given state parameter (expired or already used)",
    );
  });

  it("[rpc:McpServerCommandController.completeOAuthConnect] maps a token-endpoint failure to Unavailable", async () => {
    const { org } = await target.provisionTenancy();
    const server = await createOAuthMcpServer({
      org,
      name: uniqueName("tokfail"),
      discoveryUrl: mockAs.origin(),
    });
    const initiated = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: server.metadata!.id,
      org,
    });
    mockAs.tokenStatus = 502;

    const err = await expectGrpcCode(
      () =>
        clients.mcpServerCommand.completeOAuthConnect({
          mcpServerId: server.metadata!.id,
          state: initiated.state,
          authorizationCode: "code",
        }),
      Code.Unavailable,
      "complete with failing token endpoint",
    );
    expect(err.rawMessage).toContain("token exchange failed:");
    expect(err.rawMessage).toContain("returned HTTP 502");
  });

  it("[rpc:McpServerCommandController.completeOAuthConnect] DCR happy path: exchanges with the sealed PKCE verifier as a public client and records the grant", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("dcrhappy");
    const { server, initiated, completed } = await completeDcrHandshake(org, name);

    expect(completed.connected).toBe(true);
    expect(completed.targetEnvVar).toBe(TARGET_ENV_VAR);

    // The exchange the vendor saw: authorization_code grant, the DCR client,
    // no secret on any channel (public client), and a code_verifier whose
    // S256 hash is EXACTLY the code_challenge initiate put in the auth URL —
    // the full PKCE chain, proven end to end.
    expect(mockAs.capturedTokenRequests()).toHaveLength(1);
    const exchange = mockAs.capturedTokenRequests()[0]!;
    expect(exchange.grantType).toBe("authorization_code");
    expect(exchange.code).toBe("conformance-auth-code");
    expect(exchange.clientId).toBe("mock-dcr-client-1");
    expect(exchange.redirectUri).toBe(HERMETIC_OAUTH_REDIRECT_URI);
    expect(exchange.secretChannel).toBe("none");
    const challenge = new URL(initiated.authorizationUrl).searchParams.get("code_challenge");
    expect(exchange.codeVerifier).toBeDefined();
    expect(createHash("sha256").update(exchange.codeVerifier!).digest("base64url")).toBe(challenge);

    // The grant is visible through the status read.
    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });
    expect(status.connected).toBe(true);
    expect(status.targetEnvVar).toBe(TARGET_ENV_VAR);
    expect(status.authMethod).toBe("mcp_oauth");
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);

    // The access token rests in a Credential of the person who signed in:
    // an `oauth` sign-in serving the server, named for it, whose one field
    // is the server's target variable.
    const credentials = await signInsOf(org);
    expect(credentials).toHaveLength(1);
    const signIn = credentials[0]!;
    expect(signIn.metadata?.name).toBe(server.metadata?.name);
    expect(signIn.status?.source).toBe(CredentialSource.oauth);
    expect(signIn.spec?.owner.case, "a personal sign-in is the person's own").toBe("person");
    expect(signIn.spec?.serves.map((t) => (t.target.case === "mcpServer" ? t.target.value.slug : ""))).toEqual([
      server.metadata!.slug,
    ]);
    expect(Object.keys(signIn.spec?.fields ?? {})).toEqual([TARGET_ENV_VAR]);
    expect(signIn.spec?.fields[TARGET_ENV_VAR]?.value, "the token leaves the server redacted").toBe(REDACTED_MARKER);
    const token = await clients.credentialQuery.revealField({
      credentialId: signIn.metadata!.id,
      field: TARGET_ENV_VAR,
    });
    expect(token.value, "the person reveals their own access token").toMatch(/^mock-access-token-/);
  });

  it("[rpc:McpServerCommandController.completeOAuthConnect] vendor happy path: presents the client secret via Basic by default and via the form body on client_secret_post", async () => {
    const { org } = await target.provisionTenancy();

    const basicApp = await createVendorOAuthApp(org, uniqueName("vbasic"));
    const basicServer = await createOAuthMcpServer({
      org,
      name: uniqueName("vbasicsrv"),
      oauthAppSlug: basicApp.metadata!.slug,
    });
    const basicInit = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: basicServer.metadata!.id,
      org,
    });
    const basicDone = await clients.mcpServerCommand.completeOAuthConnect({
      mcpServerId: basicServer.metadata!.id,
      state: basicInit.state,
      authorizationCode: "vendor-code",
    });
    expect(basicDone.connected).toBe(true);

    const postApp = await createVendorOAuthApp(org, uniqueName("vpost"), {
      tokenEndpointAuthMethod: TokenEndpointAuthMethod.CLIENT_SECRET_POST,
    });
    const postServer = await createOAuthMcpServer({
      org,
      name: uniqueName("vpostsrv"),
      oauthAppSlug: postApp.metadata!.slug,
    });
    const postInit = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: postServer.metadata!.id,
      org,
    });
    await clients.mcpServerCommand.completeOAuthConnect({
      mcpServerId: postServer.metadata!.id,
      state: postInit.state,
      authorizationCode: "vendor-code",
    });

    // RFC 6749 §2.3: exactly one credential channel per request.
    expect(mockAs.capturedTokenRequests()).toHaveLength(2);
    const basicExchange = mockAs.capturedTokenRequests()[0]!;
    const postExchange = mockAs.capturedTokenRequests()[1]!;
    expect(basicExchange.secretChannel).toBe("basic");
    expect(basicExchange.clientSecret).toBe("conformance-client-secret");
    expect(postExchange.secretChannel).toBe("post");
    expect(postExchange.clientSecret).toBe("conformance-client-secret");

    // The vendor grant records its auth method.
    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: basicServer.metadata!.id,
      org,
    });
    expect(status.authMethod).toBe("vendor_oauth");
  });

  it("[rpc:McpServerCommandController.completeOAuthConnect] re-connect writes the new token into the same sign-in credential instead of creating a second one", async () => {
    const { org } = await target.provisionTenancy();
    const { server } = await completeDcrHandshake(org, uniqueName("dcrreuse"));
    const first = (await signInsOf(org))[0]!;
    const firstToken = await clients.credentialQuery.revealField({
      credentialId: first.metadata!.id,
      field: TARGET_ENV_VAR,
    });

    const again = await clients.mcpServerCommand.initiateOAuthConnect({
      mcpServerId: server.metadata!.id,
      org,
    });
    await clients.mcpServerCommand.completeOAuthConnect({
      mcpServerId: server.metadata!.id,
      state: again.state,
      authorizationCode: "second-code",
    });

    const credentials = await signInsOf(org);
    expect(credentials, "re-connect must reuse, not accumulate, sign-in credentials").toHaveLength(1);
    expect(credentials[0]!.metadata?.id).toBe(first.metadata?.id);
    const token = await clients.credentialQuery.revealField({
      credentialId: first.metadata!.id,
      field: TARGET_ENV_VAR,
    });
    expect(token.value, "the sign-in holds the second exchange's token").toMatch(/^mock-access-token-/);
    expect(token.value).not.toBe(firstToken.value);
  });
});

describe("McpServer connect conformance — a sign-in's fields are the platform's", () => {
  // The refusal copy, byte-pinned in the server's credential constants.
  const SIGN_IN_FIELDS_ARE_THE_PLATFORMS =
    "this credential holds an MCP server sign-in; its values are kept fresh by the platform and cannot be set or removed by hand — sign out and sign in again instead";

  it("[rpc:CredentialCommandController.setFields] [rpc:CredentialCommandController.removeFields] a sign-in's fields can be neither set nor removed by hand", async () => {
    const { org } = await target.provisionTenancy();
    await completeDcrHandshake(org, uniqueName("signin-fields"));
    const signIn = (await signInsOf(org))[0]!;

    const set = await expectGrpcCode(
      () =>
        clients.credentialCommand.setFields({
          credentialId: signIn.metadata!.id,
          fields: { [TARGET_ENV_VAR]: { value: "planted-token", plain: false, description: "" } },
        }),
      Code.FailedPrecondition,
      "setFields on a sign-in",
    );
    expect(set.rawMessage).toBe(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
    const removed = await expectGrpcCode(
      () => clients.credentialCommand.removeFields({ credentialId: signIn.metadata!.id, fields: [TARGET_ENV_VAR] }),
      Code.FailedPrecondition,
      "removeFields on a sign-in",
    );
    expect(removed.rawMessage).toBe(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
  });

  it("[rpc:CredentialCommandController.update] an update may rename a sign-in, keeping its fields as the marker, and may not change a field", async () => {
    const { org } = await target.provisionTenancy();
    await completeDcrHandshake(org, uniqueName("signin-update"));
    const signIn = (await signInsOf(org))[0]!;

    const renamed = await clients.credentialCommand.update({
      ...signIn,
      metadata: { ...signIn.metadata!, name: uniqueName("renamed-sign-in") },
    });
    expect(renamed.status?.source, "a rename keeps the sign-in a sign-in").toBe(CredentialSource.oauth);
    expect(renamed.spec?.fields[TARGET_ENV_VAR]?.value).toBe(REDACTED_MARKER);

    const refused = await expectGrpcCode(
      () =>
        clients.credentialCommand.update({
          ...renamed,
          spec: {
            ...renamed.spec!,
            fields: { [TARGET_ENV_VAR]: create(CredentialFieldSchema, { value: "planted-token" }) },
          },
        }),
      Code.FailedPrecondition,
      "an update replacing a sign-in's token",
    );
    expect(refused.rawMessage).toBe(SIGN_IN_FIELDS_ARE_THE_PLATFORMS);
  });

  it("[rpc:CredentialCommandController.delete] deleting a sign-in's credential signs the person out", async () => {
    const { org } = await target.provisionTenancy();
    const { server } = await completeDcrHandshake(org, uniqueName("signin-delete"));
    const signIn = (await signInsOf(org))[0]!;

    await clients.credentialCommand.delete({ resourceId: signIn.metadata!.id });

    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });
    expect(status.connected).toBe(false);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
  });
});

describe("McpServer connect conformance — grant health boundaries", () => {
  it("[rpc:McpServerQueryController.getOAuthGrantStatus] reports HEALTHY for a token without an expiry (expires_in absent means never expires)", async () => {
    const { org } = await target.provisionTenancy();
    mockAs.tokenExpiresIn = undefined;
    const { server } = await completeDcrHandshake(org, uniqueName("noexpiry"));

    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });

    expect(status.connected).toBe(true);
    expect(status.accessTokenExpiresAt).toBe(0n);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);
  });

  it("[rpc:McpServerQueryController.getOAuthGrantStatus] reports TOKEN_EXPIRED_REFRESHABLE inside the 60s refresh buffer when a refresh token exists", async () => {
    const { org } = await target.provisionTenancy();
    // 30s < the 60s buffer: the grant is born already inside the refresh
    // window — the boundary lever, no clock manipulation needed.
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = true;
    const { server } = await completeDcrHandshake(org, uniqueName("refreshable"));

    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });

    expect(status.connected).toBe(true);
    expect(status.connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE,
    );
  });

  it("[rpc:McpServerQueryController.getOAuthGrantStatus] reports TOKEN_EXPIRED when the vendor issued no refresh token", async () => {
    const { org } = await target.provisionTenancy();
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = false;
    const { server } = await completeDcrHandshake(org, uniqueName("norefresh"));

    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });

    // The refresh token is sealed on the grant only when the vendor issued
    // one, so a grant without one is honestly not refreshable (the two
    // editions converged on this answer, stigmer/stigmer#863).
    expect(status.connected).toBe(true);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED);
  });
});

describe("McpServer connect conformance — disconnect teardown", () => {
  it("[rpc:McpServerCommandController.disconnectOAuth] tears down the grant and its sign-in credential, then answers false on repeat", async () => {
    const { org } = await target.provisionTenancy();
    const { server } = await completeDcrHandshake(org, uniqueName("teardown"));

    const first = await clients.mcpServerCommand.disconnectOAuth({
      resourceId: server.metadata!.id,
      org,
    });
    expect(first.disconnected).toBe(true);

    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });
    expect(status.connected).toBe(false);
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);

    expect(await signInsOf(org), "the token-holding sign-in credential must be deleted").toHaveLength(0);

    const second = await clients.mcpServerCommand.disconnectOAuth({
      resourceId: server.metadata!.id,
      org,
    });
    expect(second.disconnected).toBe(false);
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

  it("[rpc:McpServerCommandController.connect] refuses a connect whose server needs a key the person has no credential for, naming the key", async () => {
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
      "connect with no credential serving the server",
    );
    expect(err.rawMessage).toContain(`MCP server '${server.metadata!.slug}' needs CONF_REQUIRED_KEY`);
    expect(err.rawMessage).toContain("save a credential of yours that serves it");
  });

  it("[rpc:McpServerCommandController.connect] discovers a server that declares a key once the person's own credential serves it — the ephemeral ExecutionContext is created and decrypted for the runner", async () => {
    // The credentialed connect is the connect lane's whole reason to mint a
    // token: the declared key is saved as a secret, the server resolves it
    // into an ephemeral ExecutionContext for this connect, and the runner
    // reads it back DECRYPTED with the payload's token. A redacted read fails
    // discovery loudly (the runner's CredentialResolutionError), so SUCCEEDED
    // with tools proves the decrypt lane end to end. The row's deletion at
    // settle is the server's own unit arm (no list RPC exposes it here).
    const { org } = await target.provisionTenancy();
    const server = await clients.mcpServerCommand.create(
      makeHttpMcpServer({
        org,
        name: uniqueName("credentialed"),
        url: mcpTools.url(),
        env: { CONF_REQUIRED_KEY: { description: "a required credential", isSecret: true } },
      }),
    );
    fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
    const credential = await clients.credentialCommand.create(
      makeCredential({
        org,
        name: uniqueName("credential"),
        fields: { CONF_REQUIRED_KEY: { value: "conformance-credential" } },
        serves: [mcpServerTarget(refOf(server))],
      }),
    );
    fixtures.defer(() => clients.credentialCommand.delete({ resourceId: credential.metadata!.id }));

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
  it("[rpc:McpServerCommandController.connect] refreshes an expired grant through the refresh_token grant before discovering", async () => {
    const { org } = await target.provisionTenancy();
    // Handshake leaves a grant already inside the 60s refresh window, with a
    // refresh token to redeem.
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = true;
    const { server } = await completeDcrHandshake(org, uniqueName("refresh"), {
      url: mcpTools.url(),
    });
    // The refreshed token should be born healthy.
    mockAs.tokenExpiresIn = 3600;

    const connected = await clients.mcpServerCommand.connect({
      mcpServerId: server.metadata!.id,
      org,
    });

    expect(connected.status?.connectStatus?.phase).toBe(ConnectPhase.succeeded);

    // The vendor saw the refresh: a refresh_token grant redeeming the token
    // the handshake issued, as the same public client.
    const refresh = mockAs.capturedTokenRequests().at(-1)!;
    expect(refresh.grantType).toBe("refresh_token");
    expect(refresh.refreshToken).toBe("mock-refresh-token-1");
    expect(refresh.clientId).toBe("mock-dcr-client-1");
    expect(refresh.secretChannel).toBe("none");

    // And the grant's recorded expiry advanced out of the refresh window.
    const status = await clients.mcpServerQuery.getOAuthGrantStatus({
      resourceId: server.metadata!.id,
      org,
    });
    expect(status.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);
  });

  it("[rpc:McpServerCommandController.connect] surfaces a failing refresh as FailedPrecondition with the re-authenticate copy (pinned)", async () => {
    const { org } = await target.provisionTenancy();
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = true;
    const { server } = await completeDcrHandshake(org, uniqueName("refreshfail"), {
      url: mcpTools.url(),
    });
    mockAs.tokenStatus = 500;

    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "connect with failing token refresh",
    );
    expect(err.rawMessage).toBe(
      `token refresh failed for resource '${server.metadata!.id}': ` +
        `token endpoint ${mockAs.tokenEndpoint()} returned HTTP 500: {"error":"server_error"}. ` +
        "Please re-authenticate via OAuth Connect",
    );
  });

  it("[rpc:McpServerCommandController.connect] refuses a connect on an expired grant with no refresh token, with the re-authenticate copy, asking the vendor nothing", async () => {
    const { org } = await target.provisionTenancy();
    mockAs.tokenExpiresIn = 30;
    mockAs.issueRefreshToken = false;
    const { server } = await completeDcrHandshake(org, uniqueName("norefreshconnect"), {
      url: mcpTools.url(),
    });
    const exchangesBeforeConnect = mockAs.capturedTokenRequests().length;

    // An expired grant with no refresh token is refused before any connect
    // run starts, rather than proceeding with a token the target server
    // would refuse later: the refresh token is sealed on the grant only when
    // the vendor issued one (stigmer/stigmer#863, converged across editions).
    const err = await expectGrpcCode(
      () => clients.mcpServerCommand.connect({ mcpServerId: server.metadata!.id, org }),
      Code.FailedPrecondition,
      "connect with an expired, unrefreshable grant",
    );
    expect(err.rawMessage).toBe(
      `access token for resource '${server.metadata!.id}' has expired and no refresh ` +
        "token is available. Please re-authenticate via OAuth Connect",
    );
    expect(mockAs.capturedTokenRequests().length, "no refresh attempt must reach the vendor").toBe(
      exchangesBeforeConnect,
    );
  });
});