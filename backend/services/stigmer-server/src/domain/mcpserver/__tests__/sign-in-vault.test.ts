/**
 * Pins where a sign-in lands and whose it is, at the handler layer over a
 * REAL sqlite store and the REAL vault service, with a vendor OAuth server
 * (no discovery round trip) and a token endpoint answered by an injected
 * fetch:
 *
 *   - two members signing in to the same server each save into their own
 *     My vault, and neither's run-time login is the other's (the defect
 *     that made the first person to sign in sign in for everyone);
 *   - a state is its signer's: another account cannot complete it, a
 *     state recorded with no signer is nobody's, and a caller with no
 *     identity cannot start one;
 *   - a sign-in saves at the address the server had when it started: an
 *     address changed while it was pending refuses it, so the login never
 *     reaches the new host;
 *   - a sign-in never replaces a login at its address that is not a
 *     sign-in to the same server (a pasted login, another server's
 *     sign-in): it is refused before the exchange, naming the address,
 *     and again at the save for one saved during the exchange;
 *     a re-sign-in to the same server replaces its own;
 *   - a named shared vault needs can_edit, at initiate and at complete;
 *     a sign-in into My vault needs can_create_vault on the organization,
 *     at initiate and at complete, so a caller who may connect but keeps
 *     no My vault there gets none created and no token minted;
 *   - a completion refused for the address, the vault or a full vault is
 *     refused before the code exchange, so no token is minted for it; a
 *     re-sign-in into a full vault replaces its login in place;
 *   - a server with no address has nowhere to save a login, and is
 *     refused before any request leaves for the vendor: a local program
 *     with no discovery URL, and an HTTP server whose URL holds a ${VAR}
 *     placeholder or is otherwise no fixed URL;
 *   - status and disconnect read and remove the caller's own sign-in for
 *     the server only: never a pasted login, another server's sign-in at
 *     the same address, or a teammate's; status reads a sign-in made
 *     while the server was another kind (HTTP or a local program) as no
 *     grant, as a run refuses it; disconnect still works once the
 *     server is deleted, and health reads the sign-in record (refreshable,
 *     expired);
 *   - a re-sign-in the provider answers without a refresh token keeps the
 *     one the previous sign-in saved only when the same person saved it
 *     for the same server, client and token endpoint: a teammate's sign-in
 *     into a shared vault never inherits the previous signer's;
 *   - a renewal writes through the vault (rotated refresh token, new
 *     expiry) and presents the app's secret only when it can read it, and
 *     a fresh token is used as it is; a renewal that read a login someone
 *     has since replaced leaves the newer login in place;
 *   - a renewal never sends the secret of an app the server was repointed
 *     at: an app whose client id or token URL is not the sign-in's renews
 *     without one, as a sign-in whose app is gone does.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { HttpServerConfigSchema, StdioServerConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  CompleteOAuthConnectInputSchema,
  DisconnectOAuthInputSchema,
  GetOAuthGrantStatusInputSchema,
  InitiateOAuthConnectInputSchema,
  OAuthConnectionHealth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import { SecretService } from "../../../encryption/encryption.js";
import type { Authorizer, AuthzCheck } from "../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { newVaultService } from "../../vault/service.js";
import type { VaultService } from "../../vault/service.js";
import { VaultConnectionSource } from "../../vault/service.js";
import { MAX_VAULT_ENTRIES } from "../../vault/constants.js";
import { completeOAuthConnect } from "../complete-oauth-connect.js";
import type { McpServerConnectDeps } from "../connect.js";
import { disconnectOAuth } from "../disconnect-oauth.js";
import { getOAuthGrantStatus } from "../get-oauth-grant-status.js";
import { initiateOAuthConnect } from "../initiate-oauth-connect.js";
import { newSignInFreshener } from "../oauth/refresh.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const ORG = "org_00000000000000000000000001";
const ADDRESS = "https://mcp.vendor.example/mcp";
const TOKEN_URL = "https://login.vendor.example/token";

const alice = testCallerIdentity({ identityId: "ida_alice" });
const ben = testCallerIdentity({ identityId: "ida_ben" });

let dir: string;
let store: SqliteStore;
let vaults: VaultService;
/** A request the token endpoint received: its form body and its headers. */
interface TokenRequest {
  readonly body: URLSearchParams;
  readonly headers: Headers;
}

let tokenRequests: TokenRequest[];
/** Every URL an outbound request went to, the token endpoint's included. */
let outboundCalls: string[];
let tokenBodies: unknown[];
let denyVaultEdit: boolean;
/** Denies can_create_vault on the organization: the caller may connect but keeps no My vault here. */
let denyMyVault: boolean;
/** Runs while the token endpoint answers: after completion's checks, before its save. */
let duringExchange: (() => Promise<void>) | undefined;

const secretService = SecretService.create(undefined);

const authorizer: Authorizer = {
  authorize(_caller: CallerIdentity, check: AuthzCheck) {
    if (
      denyVaultEdit &&
      check.resourceKind === ApiResourceKind.vault &&
      check.permission === IamPermission.can_edit
    ) {
      return Promise.resolve({ kind: "deny", reason: "" });
    }
    if (
      denyMyVault &&
      check.resourceKind === ApiResourceKind.organization &&
      check.permission === IamPermission.can_create_vault
    ) {
      return Promise.resolve({ kind: "deny", reason: "" });
    }
    return Promise.resolve({ kind: "allow" });
  },
};

/** The vendor's token endpoint: answers the queued bodies in order, recording each request. */
async function outboundFetch(url: string | URL, init?: RequestInit): Promise<Response> {
  outboundCalls.push(String(url));
  if (String(url) !== TOKEN_URL) {
    throw new Error(`unexpected outbound call to ${String(url)}`);
  }
  tokenRequests.push({
    body: new URLSearchParams(String(init?.body ?? "")),
    headers: new Headers(init?.headers),
  });
  await duringExchange?.();
  const body = tokenBodies.shift() ?? {
    access_token: "at-default",
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: "rt-default",
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function deps(): McpServerConnectDeps {
  const unused = <T extends object>(name: string): T =>
    new Proxy({} as T, {
      get(_target, prop) {
        throw new Error(`${name}.${String(prop)} reached by a sign-in lane`);
      },
    });
  return {
    store,
    logger: silentLogger,
    authorizer,
    engineState: unused("engineState"),
    executionContext: unused("executionContext"),
    runnerAuth: unused("runnerAuth"),
    vaults,
    vaultResolver: unused("vaultResolver"),
    pendingOAuthStates: store.pendingOAuthStates,
    secretService,
    oauthRedirectUri: "http://127.0.0.1:8234/auth/oauth/callback",
    sandboxLane: { enabled: false },
    outboundFetch,
  };
}

async function seedServer(overrides?: { stdio?: boolean }): Promise<McpServer> {
  const server = create(McpServerSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "McpServer",
    metadata: { id: "mcps_vendor", name: "Vendor", slug: "vendor", org: ORG },
    spec: {
      serverType:
        overrides?.stdio === true
          ? { case: "stdio", value: { command: "vendor-mcp" } }
          : { case: "http", value: { url: ADDRESS } },
      auth: {
        targetEnvVar: "VENDOR_TOKEN",
        oauthAppRef: { org: ORG, slug: "vendor-app", kind: ApiResourceKind.oauth_app },
      },
      env: { VENDOR_TOKEN: { isSecret: true } },
    },
  });
  await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);
  const app = create(OAuthAppSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "OAuthApp",
    metadata: { id: "oap_vendor", name: "vendor-app", slug: "vendor-app", org: ORG },
    spec: {
      provider: "vendor",
      clientId: "vendor-client",
      clientSecret: "vendor-secret",
      authorizationUrl: "https://login.vendor.example/authorize",
      tokenUrl: TOKEN_URL,
      scopes: ["read"],
      vendorApprovalStatus: VendorApprovalStatus.APPROVED,
    },
  });
  await store.saveResource(ApiResourceKind.oauth_app, "oap_vendor", OAuthAppSchema, app);
  return server;
}

async function seedSharedVault(): Promise<string> {
  const vault = create(VaultSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: { id: "vlt_shared", name: "Support tools", slug: "support-tools", org: ORG },
    spec: { owner: { case: "org", value: ORG } },
  });
  await store.saveResource(ApiResourceKind.vault, "vlt_shared", VaultSchema, vault);
  return "vlt_shared";
}

async function signIn(
  caller: CallerIdentity,
  token: { access: string; refresh: string },
  vaultId = "",
): Promise<void> {
  const started = await initiateOAuthConnect(
    deps(),
    create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId }),
    caller,
  );
  tokenBodies.push({
    access_token: token.access,
    token_type: "bearer",
    expires_in: 3600,
    refresh_token: token.refresh,
  });
  await completeOAuthConnect(
    deps(),
    create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
    caller,
  );
}

async function loginOf(caller: CallerIdentity): Promise<string | undefined> {
  const mine = await vaults.findMine(ORG, caller.identityId);
  if (mine === undefined) {
    return undefined;
  }
  return (await vaults.open(mine)).connections.get(ADDRESS)?.token;
}

async function expectRefusal(promise: Promise<unknown>, code: Code, fragment: string): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  expect((error as ConnectError).code).toBe(code);
  expect((error as ConnectError).rawMessage).toContain(fragment);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "mcpserver-sign-in-vault-"));
  store = SqliteStore.open(path.join(dir, "test.db"));
  vaults = newVaultService({
    store,
    logger: silentLogger,
    secretService,
    authorizationLifecycle: undefined,
  });
  tokenRequests = [];
  outboundCalls = [];
  tokenBodies = [];
  denyVaultEdit = false;
  denyMyVault = false;
  duringExchange = undefined;
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a sign-in saves into the signer's own vault", () => {
  it("two members signing in to one server each keep their own login, never the other's", async () => {
    await seedServer();
    await signIn(alice, { access: "at-alice", refresh: "rt-alice" });
    await signIn(ben, { access: "at-ben", refresh: "rt-ben" });

    expect(await loginOf(alice)).toBe("at-alice");
    expect(await loginOf(ben)).toBe("at-ben");

    // The connection carries its sign-in record, refresh token sealed beside it.
    const mine = await vaults.findMine(ORG, alice.identityId);
    const opened = await vaults.open(mine!);
    const connection = opened.connections.get(ADDRESS)!;
    expect(connection.source).toBe(VaultConnectionSource.sign_in);
    expect(connection.signIn?.refreshToken).toBe("rt-alice");
    expect(connection.signIn?.authMethod).toBe("vendor_oauth");
    expect(connection.signIn?.mcpServerId).toBe("mcps_vendor");
    expect(connection.signIn?.expiresAt ?? 0n).toBeGreaterThan(0n);
  });

  it("re-signing in replaces the login in place", async () => {
    await seedServer();
    await signIn(alice, { access: "at-1", refresh: "rt-1" });
    const first = await vaults.findMine(ORG, alice.identityId);
    await signIn(alice, { access: "at-2", refresh: "rt-2" });
    const second = await vaults.findMine(ORG, alice.identityId);
    expect(second?.metadata?.id).toBe(first?.metadata?.id);
    expect(await loginOf(alice)).toBe("at-2");
    expect(Object.keys(second?.spec?.connections ?? {})).toEqual([ADDRESS]);
  });

  it("refuses a sign-in over a pasted login or another server's sign-in at its address, before the exchange, keeping that login", async () => {
    await seedServer();
    const mine = await vaults.ensureMine(ORG, alice);
    const saved = [
      { what: "a pasted login", token: "pasted", write: { token: "pasted", source: VaultConnectionSource.pasted } },
      {
        what: "another tool's sign-in",
        token: "at-other-server",
        write: {
          token: "at-other-server",
          source: VaultConnectionSource.sign_in,
          signIn: {
            expiresAt: 0n,
            clientId: "other-client",
            authMethod: "mcp_oauth",
            tokenEndpoint: TOKEN_URL,
            refreshToken: "",
            mcpServerId: "mcps_other",
          },
        },
      },
    ];
    for (const login of saved) {
      await vaults.setConnection(mine.metadata!.id, ADDRESS, login.write, alice);
      const started = await initiateOAuthConnect(
        deps(),
        create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
        alice,
      );
      await expectRefusal(
        completeOAuthConnect(
          deps(),
          create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
          alice,
        ),
        Code.FailedPrecondition,
        `this vault already holds ${login.what} for ${ADDRESS}, which this sign-in would replace: remove that login first`,
      );
      // Refused before the exchange: the provider's code is never spent.
      expect(tokenRequests).toEqual([]);
      expect(await loginOf(alice)).toBe(login.token);
    }
  });

  it("refuses a sign-in over a pasted login saved during its exchange, keeping that login", async () => {
    await seedServer();
    const mine = await vaults.ensureMine(ORG, alice);
    duringExchange = async () => {
      await vaults.setConnection(
        mine.metadata!.id,
        ADDRESS,
        { token: "pasted-meanwhile", source: VaultConnectionSource.pasted },
        alice,
      );
    };
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
      alice,
    );
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        alice,
      ),
      Code.FailedPrecondition,
      `this vault already holds a pasted login for ${ADDRESS}, which this sign-in would replace: remove that login first`,
    );
    expect(tokenRequests).toHaveLength(1);
    expect(await loginOf(alice)).toBe("pasted-meanwhile");
  });

  it("a re-sign-in answered without a refresh token keeps the previous one", async () => {
    await seedServer();
    await signIn(alice, { access: "at-1", refresh: "rt-1" });
    await signIn(alice, { access: "at-2", refresh: "" });
    const opened = await vaults.open((await vaults.findMine(ORG, alice.identityId))!);
    const connection = opened.connections.get(ADDRESS)!;
    expect(connection.token).toBe("at-2");
    expect(connection.signIn?.refreshToken).toBe("rt-1");
  });

  it("a re-sign-in answered without a refresh token keeps none issued to another client or token endpoint", async () => {
    await seedServer();
    const mine = await vaults.ensureMine(ORG, alice);
    const previous = [
      { clientId: "dcr-earlier-client", tokenEndpoint: TOKEN_URL },
      { clientId: "vendor-client", tokenEndpoint: "https://login.earlier.example/token" },
    ];
    for (const issuer of previous) {
      await vaults.setConnection(
        mine.metadata!.id,
        ADDRESS,
        {
          token: "at-earlier",
          source: VaultConnectionSource.sign_in,
          signIn: {
            expiresAt: 0n,
            clientId: issuer.clientId,
            authMethod: "vendor_oauth",
            tokenEndpoint: issuer.tokenEndpoint,
            refreshToken: "rt-earlier",
            mcpServerId: "mcps_vendor",
          },
        },
        alice,
      );
      await signIn(alice, { access: "at-now", refresh: "" });
      const opened = await vaults.open((await vaults.findMine(ORG, alice.identityId))!);
      const connection = opened.connections.get(ADDRESS)!;
      expect(connection.token).toBe("at-now");
      expect(connection.signIn?.clientId).toBe("vendor-client");
      expect(connection.signIn?.refreshToken).toBe("");
    }
  });

  it("another account cannot complete a sign-in someone else started", async () => {
    await seedServer();
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
      alice,
    );
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        ben,
      ),
      Code.FailedPrecondition,
      "started by another account",
    );
    expect(await loginOf(ben)).toBeUndefined();
    // The provider's code is never spent on the wrong account.
    expect(tokenRequests).toEqual([]);
  });

  it("refuses a state recorded without a signer: the signer is compared exactly", async () => {
    await seedServer();
    await store.pendingOAuthStates.save({
      state: "state-no-signer",
      codeVerifier: "verifier",
      clientId: "vendor-client",
      clientSecret: "",
      tokenEndpoint: TOKEN_URL,
      mcpServerId: "mcps_vendor",
      identityAccountId: "",
      targetEnvVar: "VENDOR_TOKEN",
      authMethod: "vendor_oauth",
      tokenAuthMethod: "",
      redirectUri: "http://127.0.0.1:8234/auth/oauth/callback",
      org: ORG,
      vaultId: "",
      toolAddress: ADDRESS,
      createdAt: 0,
    });
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: "state-no-signer", authorizationCode: "code" }),
        alice,
      ),
      Code.FailedPrecondition,
      "started by another account",
    );
    expect(await vaults.findMine(ORG, alice.identityId)).toBeUndefined();
    expect(tokenRequests).toEqual([]);
  });

  it("refuses to start a sign-in for a caller with no identity", async () => {
    await seedServer();
    await expectRefusal(
      initiateOAuthConnect(
        deps(),
        create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
        testCallerIdentity({ identityId: "" }),
      ),
      Code.Unauthenticated,
      "a sign-in is saved for a signed-in caller",
    );
  });

  it("refuses at complete when the server's address changed after the sign-in started", async () => {
    const server = await seedServer();
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
      alice,
    );
    // An editor points the server at another host while the sign-in is pending.
    const moved = "https://mcp.elsewhere.example/mcp";
    server.spec!.serverType = {
      case: "http",
      value: create(HttpServerConfigSchema, { url: moved }),
    };
    await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        alice,
      ),
      Code.FailedPrecondition,
      "the tool's address changed during sign-in",
    );
    // The login is saved at neither address: it never reaches the new host.
    expect(await vaults.findMine(ORG, alice.identityId)).toBeUndefined();
    // Refused before the exchange: the provider's code is never spent.
    expect(tokenRequests).toEqual([]);
  });

  it("refuses at complete a server that lost its address after the sign-in started", async () => {
    const server = await seedServer();
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
      alice,
    );
    server.spec!.serverType = {
      case: "stdio",
      value: create(StdioServerConfigSchema, { command: "vendor-mcp" }),
    };
    await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        alice,
      ),
      Code.FailedPrecondition,
      "no longer has an address",
    );
    expect(await loginOf(alice)).toBeUndefined();
    expect(tokenRequests).toEqual([]);
  });

  it("refuses a server with no address before any round trip", async () => {
    await seedServer({ stdio: true });
    await expectRefusal(
      initiateOAuthConnect(
        deps(),
        create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
        alice,
      ),
      Code.FailedPrecondition,
      "auth.discovery_url",
    );
    expect(outboundCalls).toEqual([]);
  });

  it.each([
    ["a ${VAR} placeholder", "https://${VENDOR_HOST}/mcp", "its URL holds a ${VAR} placeholder, so it names no fixed address"],
    ["credentials", "https://user:pass@mcp.vendor.example/mcp", "its URL is not a fixed http or https URL"],
  ])(
    "refuses a DCR server whose URL holds %s before discovery or registration reaches the vendor",
    async (_what, url, why) => {
      // A DCR server: no OAuth app, so discovery and client registration
      // would be the first requests out.
      const server = create(McpServerSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "McpServer",
        metadata: { id: "mcps_vendor", name: "Vendor", slug: "vendor", org: ORG },
        spec: {
          serverType: { case: "http", value: { url } },
          auth: { targetEnvVar: "VENDOR_TOKEN" },
        },
      });
      await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);
      await expectRefusal(
        initiateOAuthConnect(
          deps(),
          create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
          alice,
        ),
        Code.FailedPrecondition,
        `MCP server 'mcps_vendor' has no address to save a sign-in at: ${why}`,
      );
      expect(outboundCalls).toEqual([]);
    },
  );
});

describe("a sign-in into My vault", () => {
  it("is refused at initiate for a caller who may connect but may keep no My vault in the organization", async () => {
    await seedServer();
    denyMyVault = true;
    await expectRefusal(
      initiateOAuthConnect(
        deps(),
        create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
        alice,
      ),
      Code.PermissionDenied,
      "unauthorized to keep a My vault in this organization: only its members do",
    );
    expect(await vaults.findMine(ORG, alice.identityId)).toBeUndefined();
    expect(tokenRequests).toEqual([]);
    expect(outboundCalls).toEqual([]);
  });

  it("is refused at complete when can_create_vault was lost after initiate, before any My vault or token", async () => {
    await seedServer();
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: "" }),
      alice,
    );
    denyMyVault = true;
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        alice,
      ),
      Code.PermissionDenied,
      "unauthorized to keep a My vault in this organization: only its members do",
    );
    expect(await vaults.findMine(ORG, alice.identityId)).toBeUndefined();
    expect(tokenRequests).toEqual([]);
  });
});

describe("a sign-in into a named shared vault", () => {
  it("is refused without can_edit on the vault", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    denyVaultEdit = true;
    await expectRefusal(
      initiateOAuthConnect(
        deps(),
        create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: shared }),
        alice,
      ),
      Code.PermissionDenied,
      "unauthorized to save a sign-in in this vault",
    );
  });

  it("answers NOT_FOUND for a vault of another organization", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    await expectRefusal(
      initiateOAuthConnect(
        deps(),
        create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: "org_00000000000000000000000002", vaultId: shared }),
        alice,
      ),
      Code.NotFound,
      "vault not found",
    );
  });

  it("lands in the shared vault, not the signer's My vault, when the signer may edit it", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    await signIn(alice, { access: "at-team", refresh: "rt-team" }, shared);
    const vault = await vaults.findById(shared);
    expect((await vaults.open(vault!)).connections.get(ADDRESS)?.token).toBe("at-team");
    expect(await loginOf(alice)).toBeUndefined();
  });

  it("refuses at complete a shared vault deleted after the sign-in started, before the code is spent", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: shared }),
      alice,
    );
    await store.deleteResource(ApiResourceKind.vault, shared);
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        alice,
      ),
      Code.NotFound,
      shared,
    );
    expect(tokenRequests).toEqual([]);
    expect(await vaults.findMine(ORG, alice.identityId)).toBeUndefined();
  });

  it("a teammate's sign-in answered without a refresh token never inherits the previous signer's", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    const sharedLogin = async () =>
      (await vaults.open((await vaults.findById(shared))!)).connections.get(ADDRESS)!;

    await signIn(alice, { access: "at-alice-1", refresh: "rt-alice" }, shared);
    // Her own re-sign-in keeps her refresh token.
    await signIn(alice, { access: "at-alice-2", refresh: "" }, shared);
    expect((await sharedLogin()).signIn?.refreshToken).toBe("rt-alice");

    // His sign-in replaces hers and carries no refresh token of hers: a
    // renewal would otherwise sign the vault back in as her.
    await signIn(ben, { access: "at-ben", refresh: "" }, shared);
    const login = await sharedLogin();
    expect(login.token).toBe("at-ben");
    expect(login.signIn?.refreshToken).toBe("");
  });

  it("a teammate's run renewing a sign-in leaves it the signer's: his later sign-in still inherits nothing", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    const written = await vaults.setConnection(
      shared,
      ADDRESS,
      {
        token: "at-alice",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: BigInt(Math.floor(Date.now() / 1000) - 10),
          clientId: "vendor-client",
          authMethod: "vendor_oauth",
          tokenEndpoint: TOKEN_URL,
          refreshToken: "rt-alice",
          mcpServerId: "mcps_vendor",
        },
      },
      alice,
    );
    tokenBodies.push({ access_token: "at-alice-renewed", refresh_token: "rt-alice-rotated", expires_in: 3600 });
    const freshener = newSignInFreshener({ vaults, store, secretService, logger: silentLogger, fetchImpl: outboundFetch });
    const read = (await vaults.open(written)).connections.get(ADDRESS)!;
    expect(await freshener.freshToken(written, read, ben)).toBe("at-alice-renewed");
    expect((await vaults.findById(shared))?.spec?.connections[ADDRESS]?.savedBy).toBe(alice.identityId);

    await signIn(ben, { access: "at-ben", refresh: "" }, shared);
    const login = (await vaults.open((await vaults.findById(shared))!)).connections.get(ADDRESS)!;
    expect(login.token).toBe("at-ben");
    expect(login.signIn?.refreshToken).toBe("");
  });

  it("is refused at complete when can_edit was revoked after initiate", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: shared }),
      alice,
    );
    denyVaultEdit = true;
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        alice,
      ),
      Code.PermissionDenied,
      "unauthorized to save a sign-in in this vault",
    );
    // Refused before the exchange: no live token was minted for it.
    expect(tokenRequests).toEqual([]);
  });

  it("a full vault refuses a new login before the exchange, and still takes a re-sign-in in place", async () => {
    await seedServer();
    const shared = await seedSharedVault();
    const fill: Record<string, { value: string; description: string }> = {};
    for (let i = 0; i < MAX_VAULT_ENTRIES; i++) {
      fill[`SECRET_${i}`] = { value: `v${i}`, description: "" };
    }
    await vaults.setSecrets(shared, fill, alice);
    const started = await initiateOAuthConnect(
      deps(),
      create(InitiateOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", org: ORG, vaultId: shared }),
      alice,
    );
    await expectRefusal(
      completeOAuthConnect(
        deps(),
        create(CompleteOAuthConnectInputSchema, { mcpServerId: "mcps_vendor", state: started.state, authorizationCode: "code" }),
        alice,
      ),
      Code.FailedPrecondition,
      `a vault holds at most ${MAX_VAULT_ENTRIES} logins and secrets together`,
    );
    // Refused before the exchange: no live token was minted for it.
    expect(tokenRequests).toEqual([]);

    // A login already at the address is replaced, adding no entry: with
    // room for one login, the vault is full again once it lands.
    await vaults.removeSecrets(shared, ["SECRET_0"], alice);
    await signIn(alice, { access: "at-1", refresh: "rt-1" }, shared);
    await signIn(alice, { access: "at-2", refresh: "rt-2" }, shared);
    const vault = await vaults.findById(shared);
    const spec = vault?.spec;
    expect(Object.keys(spec?.secrets ?? {}).length + Object.keys(spec?.connections ?? {}).length).toBe(
      MAX_VAULT_ENTRIES,
    );
    expect((await vaults.open(vault!)).connections.get(ADDRESS)?.token).toBe("at-2");
  });
});

describe("status and disconnect read the caller's own login", () => {
  const status = (caller: CallerIdentity) =>
    getOAuthGrantStatus(
      deps(),
      create(GetOAuthGrantStatusInputSchema, { resourceId: "mcps_vendor", org: ORG }),
      caller,
    );
  const disconnect = (caller: CallerIdentity) =>
    disconnectOAuth(
      deps(),
      create(DisconnectOAuthInputSchema, { resourceId: "mcps_vendor", org: ORG }),
      caller,
    );

  it("a member's login is connected for them and absent for a teammate; a teammate's disconnect leaves it", async () => {
    await seedServer();
    await signIn(alice, { access: "at-alice", refresh: "rt-alice" });

    const hers = await status(alice);
    expect(hers.connected).toBe(true);
    expect(hers.targetEnvVar).toBe("VENDOR_TOKEN");
    expect(hers.authMethod).toBe("vendor_oauth");
    expect(hers.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);

    const his = await status(ben);
    expect(his.connected).toBe(false);
    expect(his.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);

    expect((await disconnect(ben)).disconnected).toBe(false);
    expect(await loginOf(alice)).toBe("at-alice");

    expect((await disconnect(alice)).disconnected).toBe(true);
    expect(await loginOf(alice)).toBeUndefined();
    expect((await disconnect(alice)).disconnected).toBe(false);
    expect((await status(alice)).connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    );
  });

  it("health reads the sign-in record: expired with a refresh token is refreshable, without one expired", async () => {
    await seedServer();
    const mine = await vaults.ensureMine(ORG, alice);
    const expired = BigInt(Math.floor(Date.now() / 1000) - 3600);
    const saveExpired = (refreshToken: string) =>
      vaults.setConnection(
        mine.metadata!.id,
        ADDRESS,
        {
          token: "at-old",
          source: VaultConnectionSource.sign_in,
          signIn: {
            expiresAt: expired,
            clientId: "vendor-client",
            authMethod: "vendor_oauth",
            tokenEndpoint: TOKEN_URL,
            refreshToken,
            mcpServerId: "mcps_vendor",
          },
        },
        alice,
      );
    await saveExpired("rt-old");
    expect((await status(alice)).connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE,
    );
    await saveExpired("");
    expect((await status(alice)).connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED,
    );
  });

  it("answers NOT_FOUND for a server that does not exist", async () => {
    await expectRefusal(
      getOAuthGrantStatus(
        deps(),
        create(GetOAuthGrantStatusInputSchema, { resourceId: "mcps_missing", org: ORG }),
        alice,
      ),
      Code.NotFound,
      "mcps_missing",
    );
  });

  it("a pasted login at the server's address is no sign-in: status answers NO_GRANT and disconnect leaves it", async () => {
    await seedServer();
    const mine = await vaults.ensureMine(ORG, alice);
    await vaults.setConnection(
      mine.metadata!.id,
      ADDRESS,
      { token: "pasted", source: VaultConnectionSource.pasted },
      alice,
    );
    const answer = await status(alice);
    expect(answer.connected).toBe(false);
    expect(answer.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
    expect((await disconnect(alice)).disconnected).toBe(false);
    expect(await loginOf(alice)).toBe("pasted");
  });

  it("another server's sign-in at the same address is not this server's: status answers NO_GRANT and disconnect leaves it", async () => {
    await seedServer();
    const mine = await vaults.ensureMine(ORG, alice);
    await vaults.setConnection(
      mine.metadata!.id,
      ADDRESS,
      {
        token: "at-other-server",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 0n,
          clientId: "other-client",
          authMethod: "mcp_oauth",
          tokenEndpoint: TOKEN_URL,
          refreshToken: "",
          mcpServerId: "mcps_other",
        },
      },
      alice,
    );
    const answer = await status(alice);
    expect(answer.connected).toBe(false);
    expect(answer.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
    expect((await disconnect(alice)).disconnected).toBe(false);
    expect(await loginOf(alice)).toBe("at-other-server");
  });

  it("a sign-in left at the server's earlier address serves no run, so status answers NO_GRANT; disconnect still removes it", async () => {
    const server = await seedServer();
    await signIn(alice, { access: "at-alice", refresh: "rt-alice" });
    server.spec!.serverType = {
      case: "http",
      value: create(HttpServerConfigSchema, { url: "https://mcp.vendor.example/v2/mcp" }),
    };
    await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);

    expect((await status(alice)).connectionHealth).toBe(
      OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT,
    );
    expect((await disconnect(alice)).disconnected).toBe(true);
    expect(await loginOf(alice)).toBeUndefined();
  });

  it("a sign-in made while the server was another kind serves no run, so status answers NO_GRANT until it signs in again", async () => {
    const server = await seedServer();
    await signIn(alice, { access: "at-http", refresh: "rt-http" });
    expect((await status(alice)).connected).toBe(true);

    // An editor makes it a local program whose login's discovery URL is
    // the old HTTP URL: the address is unchanged, the kind is not.
    server.spec!.serverType = {
      case: "stdio",
      value: create(StdioServerConfigSchema, { command: "vendor-mcp" }),
    };
    server.spec!.auth!.discoveryUrl = ADDRESS;
    await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);
    const answer = await status(alice);
    expect(answer.connected).toBe(false);
    expect(answer.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);

    // Signing in again as the local program replaces its own sign-in.
    await signIn(alice, { access: "at-local", refresh: "rt-local" });
    expect((await status(alice)).connected).toBe(true);
    expect(await loginOf(alice)).toBe("at-local");
  });

  it("disconnect removes the caller's sign-in after the server is deleted", async () => {
    await seedServer();
    await signIn(alice, { access: "at-alice", refresh: "rt-alice" });
    await store.deleteResource(ApiResourceKind.mcp_server, "mcps_vendor");

    expect((await disconnect(alice)).disconnected).toBe(true);
    expect(await loginOf(alice)).toBeUndefined();
  });
});

describe("renewal writes through the vault", () => {
  const freshener = () =>
    newSignInFreshener({ vaults, store, secretService, logger: silentLogger, fetchImpl: outboundFetch });

  async function savedSignIn(expiresAt: bigint, refreshToken: string, mcpServerId = "mcps_vendor") {
    const mine = await vaults.ensureMine(ORG, alice);
    const written = await vaults.setConnection(
      mine.metadata!.id,
      ADDRESS,
      {
        token: "at-old",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt,
          clientId: "vendor-client",
          authMethod: "vendor_oauth",
          tokenEndpoint: TOKEN_URL,
          refreshToken,
          mcpServerId,
        },
      },
      alice,
    );
    const opened = await vaults.open(written);
    return { vault: written, connection: opened.connections.get(ADDRESS)! };
  }

  it("renews an expired sign-in with the app's credentials and saves the new token and rotated refresh token", async () => {
    await seedServer();
    const { vault, connection } = await savedSignIn(
      BigInt(Math.floor(Date.now() / 1000) - 10),
      "rt-old",
    );
    tokenBodies.push({ access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 });

    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-new");

    expect(tokenRequests).toHaveLength(1);
    const request = tokenRequests[0]!;
    expect(request.body.get("grant_type")).toBe("refresh_token");
    expect(request.body.get("refresh_token")).toBe("rt-old");
    // The app's secret, presented once, by its unspecified method: Basic.
    expect(request.headers.get("authorization")).toBe(
      `Basic ${Buffer.from("vendor-client:vendor-secret").toString("base64")}`,
    );
    expect(request.body.has("client_secret")).toBe(false);
    const reopened = await vaults.open((await vaults.findMine(ORG, alice.identityId))!);
    const saved = reopened.connections.get(ADDRESS)!;
    expect(saved.token).toBe("at-new");
    expect(saved.signIn?.refreshToken).toBe("rt-new");
    expect(saved.signIn?.expiresAt ?? 0n).toBeGreaterThan(BigInt(Math.floor(Date.now() / 1000)));
  });

  it("a renewal of a login replaced since it was read leaves the newer login in place", async () => {
    await seedServer();
    const { vault, connection } = await savedSignIn(
      BigInt(Math.floor(Date.now() / 1000) - 10),
      "rt-old",
    );
    // A fresh sign-in lands between the run's read and its renewal.
    await vaults.setConnection(
      vault.metadata!.id,
      ADDRESS,
      {
        token: "at-fresh-sign-in",
        source: VaultConnectionSource.sign_in,
        signIn: { ...connection.signIn!, refreshToken: "rt-fresh", expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600) },
      },
      alice,
    );
    tokenBodies.push({ access_token: "at-renewed", refresh_token: "rt-renewed", expires_in: 3600 });

    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-renewed");
    const reopened = await vaults.open((await vaults.findMine(ORG, alice.identityId))!);
    const saved = reopened.connections.get(ADDRESS)!;
    expect(saved.token).toBe("at-fresh-sign-in");
    expect(saved.signIn?.refreshToken).toBe("rt-fresh");
  });

  it("uses a sign-in that has not expired as it is, with no round trip", async () => {
    await seedServer();
    const { vault, connection } = await savedSignIn(
      BigInt(Math.floor(Date.now() / 1000) + 3600),
      "rt-old",
    );
    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-old");
    expect(tokenRequests).toEqual([]);
  });

  it("refuses an expired sign-in with no refresh token, saying why", async () => {
    await seedServer();
    const { vault, connection } = await savedSignIn(
      BigInt(Math.floor(Date.now() / 1000) - 10),
      "",
    );
    await expect(freshener().freshToken(vault, connection, alice)).rejects.toThrow(
      "it has expired and no refresh token is available",
    );
  });

  /** A freshener over the store with one method replaced. */
  function freshenerOver(overrides: Record<string, unknown>) {
    const faulty = new Proxy(store, {
      get(target, prop, receiver) {
        if (typeof prop === "string" && prop in overrides) {
          return overrides[prop];
        }
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    return newSignInFreshener({
      vaults,
      store: faulty,
      secretService,
      logger: silentLogger,
      fetchImpl: outboundFetch,
    });
  }

  const expired = () => BigInt(Math.floor(Date.now() / 1000) - 10);
  const fault = async (): Promise<never> => {
    throw new Error("disk gone");
  };

  it("renews without the app's secret when the app cannot be read, whatever the reason", async () => {
    // The sign-in names no server; the server is gone; the store faults on
    // it; the server names no app; the app is gone; the apps cannot be
    // listed; the app's secret cannot be opened. Each renews as a public
    // client would, and the provider decides.
    const cases: Array<{ seed: () => Promise<void>; mcpServerId?: string; freshener?: ReturnType<typeof freshenerOver> }> = [
      { seed: async () => {}, mcpServerId: "" },
      { seed: async () => {}, mcpServerId: "mcps_gone" },
      { seed: async () => { await seedServer(); }, freshener: freshenerOver({ getResource: fault }) },
      {
        seed: async () => {
          const server = await seedServer();
          server.spec!.auth!.oauthAppRef = undefined;
          await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);
        },
      },
      {
        seed: async () => {
          await seedServer();
          await store.deleteResource(ApiResourceKind.oauth_app, "oap_vendor");
        },
      },
      { seed: async () => { await seedServer(); }, freshener: freshenerOver({ listResources: fault }) },
      {
        seed: async () => {
          await seedServer();
          const app = await store.getResource(ApiResourceKind.oauth_app, "oap_vendor", OAuthAppSchema);
          app.spec!.clientSecret = "enc:v1:bm90LWEtcmVhbC1jaXBoZXJ0ZXh0";
          await store.saveResource(ApiResourceKind.oauth_app, "oap_vendor", OAuthAppSchema, app);
        },
      },
    ];
    for (const [index, c] of cases.entries()) {
      await c.seed();
      const { vault, connection } = await savedSignIn(expired(), "rt-old", c.mcpServerId ?? "mcps_vendor");
      tokenBodies.push({ access_token: `at-${index}`, expires_in: 3600 });
      const renewed = await (c.freshener ?? freshener()).freshToken(vault, connection, alice);
      expect(renewed).toBe(`at-${index}`);
      expect(tokenRequests).toHaveLength(index + 1);
      const request = tokenRequests[index]!;
      expect(request.body.get("refresh_token")).toBe("rt-old");
      expect(request.body.get("client_id")).toBe("vendor-client");
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.body.has("client_secret")).toBe(false);
    }
  });

  it("never sends another app's secret: a server repointed at an app with another client or token URL renews without one", async () => {
    // An editor points the server at another OAuth app after the sign-in;
    // the renewal still goes to the sign-in's own token endpoint and client.
    const apps = [
      { id: "oap_other_client", clientId: "other-client", tokenUrl: TOKEN_URL },
      { id: "oap_other_endpoint", clientId: "vendor-client", tokenUrl: "https://login.other.example/token" },
    ];
    for (const [index, other] of apps.entries()) {
      const server = await seedServer();
      await store.saveResource(
        ApiResourceKind.oauth_app,
        other.id,
        OAuthAppSchema,
        create(OAuthAppSchema, {
          apiVersion: "iam.stigmer.ai/v1",
          kind: "OAuthApp",
          metadata: { id: other.id, name: other.id, slug: other.id, org: ORG },
          spec: {
            provider: "other",
            clientId: other.clientId,
            clientSecret: "other-secret",
            authorizationUrl: "https://login.other.example/authorize",
            tokenUrl: other.tokenUrl,
            scopes: ["read"],
            vendorApprovalStatus: VendorApprovalStatus.APPROVED,
          },
        }),
      );
      server.spec!.auth!.oauthAppRef = create(ApiResourceReferenceSchema, {
        org: ORG,
        slug: other.id,
        kind: ApiResourceKind.oauth_app,
      });
      await store.saveResource(ApiResourceKind.mcp_server, "mcps_vendor", McpServerSchema, server);

      const { vault, connection } = await savedSignIn(expired(), "rt-old");
      tokenBodies.push({ access_token: `at-${index}`, expires_in: 3600 });
      expect(await freshener().freshToken(vault, connection, alice)).toBe(`at-${index}`);
      const request = tokenRequests[index]!;
      expect(request.body.get("client_id")).toBe("vendor-client");
      expect(request.headers.has("authorization")).toBe(false);
      expect(request.body.has("client_secret")).toBe(false);
    }
  });
});
