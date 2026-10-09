/**
 * Pins a person's sign-in at an address and where it lands, at the handler
 * layer over a REAL sqlite store and the REAL vault service, with every
 * login server answered by the rig's recording fetch (support.ts):
 *
 *   - two members signing in at one address each save into their own My
 *     vault, and neither's login is the other's;
 *   - a state is its signer's: another account cannot complete it, a state
 *     with no signer (a Connect link's) is no person's, and a caller with no
 *     identity cannot start one;
 *   - a sign-in replaces whatever login its address holds, a pasted one
 *     included (a sign-in and a pasted login serve the same tools), and a
 *     re-sign-in answered without a refresh token keeps the previous one
 *     only when the same person saved it through the same login app, client
 *     and token endpoint;
 *   - an address is normalized, and one nothing can sign in to is refused
 *     before any request leaves: a Git host with no login app, a value that
 *     is no address at all, an app its vendor has not approved, and an app
 *     whose stored endpoints are neither https nor loopback http;
 *   - a named shared vault needs can_edit, and My vault can_create_vault on
 *     the organization, each at start and again at completion, before the
 *     code is exchanged; a full vault refuses a new login before the
 *     exchange and takes a re-sign-in in place;
 *   - the saved login is described by the account the login app's endpoint
 *     names ("Vendor @ana"), else by the host;
 *   - the return choice builds the redirect: the console's callback, the same
 *     with the desktop bridge, or a loopback port;
 *   - McpServer's status and disconnect read the caller's sign-in at the
 *     server's address, whichever page started it, never a pasted login or a
 *     teammate's;
 *   - a renewal writes through the vault and presents the login app's secret
 *     (found by the sign-in's recorded login_app) only while the app's
 *     client id and token URL are the sign-in's; a catalog entry's secret
 *     comes from the deployment's settings; a login app's sign-in saved
 *     before apps were recorded finds its app by its address under the same
 *     guard, and only a public client's renewal carries `resource`.
 */
import { create } from "@bufbuild/protobuf";
import { Code } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import {
  DisconnectOAuthInputSchema,
  GetOAuthGrantStatusInputSchema,
  OAuthConnectionHealth,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/io_pb";
import {
  CompleteSignInInputSchema,
  SignInReturn,
  StartSignInInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import type { StartSignInOutput } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";

import type { CallerIdentity } from "../../../../extensions/identity.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import type { McpServerConnectDeps } from "../../../mcpserver/connect.js";
import { disconnectOAuth } from "../../../mcpserver/disconnect-oauth.js";
import { getOAuthGrantStatus } from "../../../mcpserver/get-oauth-grant-status.js";
import { MAX_VAULT_ENTRIES } from "../../constants.js";
import { VaultConnectionSource } from "../../service.js";
import { completePersonSignIn, startPersonSignIn } from "../person.js";
import { newSignInFreshener } from "../refresh.js";
import {
  ORG,
  OTHER_ORG,
  REDIRECT_URI,
  VENDOR_ADDRESS,
  VENDOR_TOKEN_URL,
  alice,
  ben,
  expectRefusal,
  myLogin,
  openSignInRig,
  seedOrganizationApp,
  seedSharedVault,
  silentLogger,
  vaultLogin,
} from "./support.js";
import type { SignInRig } from "./support.js";

let rig: SignInRig;

beforeEach(() => {
  rig = openSignInRig();
});

afterEach(() => {
  rig.close();
});

function target(vaultId: string, org = ORG) {
  return { org, vault: vaultId === "" ? { case: "mine" as const, value: true } : { case: "id" as const, value: vaultId } };
}

function start(
  caller: CallerIdentity,
  init: { vaultId?: string; address?: string; org?: string; returnTo?: SignInReturn; loopbackPort?: number } = {},
): Promise<StartSignInOutput> {
  return startPersonSignIn(
    rig.deps(),
    create(StartSignInInputSchema, {
      vault: target(init.vaultId ?? "", init.org),
      address: init.address ?? VENDOR_ADDRESS,
      returnTo: init.returnTo ?? SignInReturn.sign_in_return_unspecified,
      loopbackPort: init.loopbackPort ?? 0,
    }),
    caller,
  );
}

function complete(caller: CallerIdentity, state: string) {
  return completePersonSignIn(rig.deps(), create(CompleteSignInInputSchema, { state, code: "code" }), caller);
}

async function signIn(
  caller: CallerIdentity,
  token: { access: string; refresh: string },
  vaultId = "",
): Promise<void> {
  const started = await start(caller, { vaultId });
  rig.levers.tokenBodies.push({
    body: { access_token: token.access, token_type: "bearer", expires_in: 3600, refresh_token: token.refresh },
  });
  await complete(caller, started.state);
}

const tokenRequests = () => rig.requestsTo(VENDOR_TOKEN_URL);

describe("a sign-in saves into the signer's own vault", () => {
  it("two members signing in at one address each keep their own login, never the other's", async () => {
    await seedOrganizationApp(rig);
    await signIn(alice, { access: "at-alice", refresh: "rt-alice" });
    await signIn(ben, { access: "at-ben", refresh: "rt-ben" });

    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("at-alice");
    expect(await myLogin(rig, ben, VENDOR_ADDRESS)).toBe("at-ben");

    // The connection carries its sign-in record, refresh token sealed beside it.
    const opened = await rig.vaults.open((await rig.vaults.findMine(ORG, alice.identityId))!);
    const connection = opened.connections.get(VENDOR_ADDRESS)!;
    expect(connection.source).toBe(VaultConnectionSource.sign_in);
    expect(connection.signIn?.refreshToken).toBe("rt-alice");
    expect(connection.signIn?.authMethod).toBe("vendor_oauth");
    expect(connection.signIn?.loginApp).toBe("org:oap_vendor");
    expect(connection.signIn?.expiresAt ?? 0n).toBeGreaterThan(0n);
  });

  it("re-signing in replaces the login in place", async () => {
    await seedOrganizationApp(rig);
    await signIn(alice, { access: "at-1", refresh: "rt-1" });
    const first = await rig.vaults.findMine(ORG, alice.identityId);
    await signIn(alice, { access: "at-2", refresh: "rt-2" });
    const second = await rig.vaults.findMine(ORG, alice.identityId);
    expect(second?.metadata?.id).toBe(first?.metadata?.id);
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("at-2");
    expect(Object.keys(second?.spec?.connections ?? {})).toEqual([VENDOR_ADDRESS]);
  });

  it("replaces a pasted login at its address, and one pasted during its exchange", async () => {
    await seedOrganizationApp(rig);
    const mine = await rig.vaults.ensureMine(ORG, alice);
    await rig.vaults.setConnection(
      mine.metadata!.id,
      VENDOR_ADDRESS,
      { token: "pasted", source: VaultConnectionSource.pasted },
      alice,
    );
    await signIn(alice, { access: "at-signed-in", refresh: "rt" });
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("at-signed-in");

    rig.levers.duringExchange = async () => {
      await rig.vaults.setConnection(
        mine.metadata!.id,
        VENDOR_ADDRESS,
        { token: "pasted-meanwhile", source: VaultConnectionSource.pasted },
        alice,
      );
    };
    await signIn(alice, { access: "at-again", refresh: "rt" });
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("at-again");
  });

  it("a re-sign-in answered without a refresh token keeps the previous one", async () => {
    await seedOrganizationApp(rig);
    await signIn(alice, { access: "at-1", refresh: "rt-1" });
    await signIn(alice, { access: "at-2", refresh: "" });
    const opened = await rig.vaults.open((await rig.vaults.findMine(ORG, alice.identityId))!);
    const connection = opened.connections.get(VENDOR_ADDRESS)!;
    expect(connection.token).toBe("at-2");
    expect(connection.signIn?.refreshToken).toBe("rt-1");
  });

  it("a re-sign-in answered without a refresh token keeps none issued through another app, client or token endpoint", async () => {
    await seedOrganizationApp(rig);
    const mine = await rig.vaults.ensureMine(ORG, alice);
    const previous = [
      { clientId: "dcr-earlier-client", tokenEndpoint: VENDOR_TOKEN_URL, loginApp: "" },
      { clientId: "vendor-client", tokenEndpoint: "https://login.earlier.example/token", loginApp: "org:oap_vendor" },
      { clientId: "vendor-client", tokenEndpoint: VENDOR_TOKEN_URL, loginApp: "org:oap_earlier" },
    ];
    for (const issuer of previous) {
      await rig.vaults.setConnection(
        mine.metadata!.id,
        VENDOR_ADDRESS,
        {
          token: "at-earlier",
          source: VaultConnectionSource.sign_in,
          signIn: {
            expiresAt: 0n,
            clientId: issuer.clientId,
            authMethod: "vendor_oauth",
            tokenEndpoint: issuer.tokenEndpoint,
            refreshToken: "rt-earlier",
            loginApp: issuer.loginApp,
          },
        },
        alice,
      );
      await signIn(alice, { access: "at-now", refresh: "" });
      const connection = (await rig.vaults.open((await rig.vaults.findMine(ORG, alice.identityId))!)).connections.get(VENDOR_ADDRESS)!;
      expect(connection.token).toBe("at-now");
      expect(connection.signIn?.refreshToken).toBe("");
    }
  });

  it("another account cannot complete a sign-in someone else started", async () => {
    await seedOrganizationApp(rig);
    const started = await start(alice);
    await expectRefusal(complete(ben, started.state), Code.FailedPrecondition, "started by another account");
    expect(await myLogin(rig, ben, VENDOR_ADDRESS)).toBeUndefined();
    // The provider's code is never spent on the wrong account.
    expect(tokenRequests()).toEqual([]);
  });

  it("refuses a state with no signer, and a Connect link's state, before the code is spent", async () => {
    await seedOrganizationApp(rig);
    const base = {
      codeVerifier: "verifier",
      clientId: "vendor-client",
      clientSecret: "",
      tokenEndpoint: VENDOR_TOKEN_URL,
      authMethod: "vendor_oauth",
      tokenAuthMethod: "",
      redirectUri: REDIRECT_URI,
      org: ORG,
      vaultId: "",
      address: VENDOR_ADDRESS,
      loginApp: "org:oap_vendor",
      resource: "",
      clientRegistration: "",
      providerName: "Vendor",
      userinfoUrl: "",
      createdAt: 0,
    };
    await rig.store.pendingOAuthStates.save({ ...base, state: "state-no-signer", identityAccountId: "", connectLink: "" });
    await rig.store.pendingOAuthStates.save({ ...base, state: "state-link", identityAccountId: "", connectLink: "link-hash" });
    await expectRefusal(complete(alice, "state-no-signer"), Code.FailedPrecondition, "started by another account");
    await expectRefusal(complete(alice, "state-link"), Code.FailedPrecondition, "started by a Connect link");
    expect(await rig.vaults.findMine(ORG, alice.identityId)).toBeUndefined();
    expect(tokenRequests()).toEqual([]);
  });

  it("refuses to start a sign-in for a caller with no identity", async () => {
    await seedOrganizationApp(rig);
    await expectRefusal(
      start(testCallerIdentity({ identityId: "" })),
      Code.Unauthenticated,
      "a sign-in is saved for a signed-in caller",
    );
  });

  it("refuses a credential bound to another organization, at start and at completion", async () => {
    await seedOrganizationApp(rig);
    const boundElsewhere = { ...alice, boundOrg: OTHER_ORG };
    await expectRefusal(start(boundElsewhere), Code.PermissionDenied, "");
    const started = await start(alice);
    await expectRefusal(complete(boundElsewhere, started.state), Code.PermissionDenied, "");
    expect(tokenRequests()).toEqual([]);
  });

  it("refuses an expired or already used state", async () => {
    await seedOrganizationApp(rig);
    const started = await start(alice);
    await complete(alice, started.state);
    await expectRefusal(complete(alice, started.state), Code.FailedPrecondition, "expired or was already used");
  });
});

describe("the address", () => {
  it("is normalized: a sign-in started at any spelling of it saves at its one address", async () => {
    await seedOrganizationApp(rig);
    const started = await start(alice, { address: "HTTPS://MCP.Vendor.example:443/mcp/" });
    await complete(alice, started.state);
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("at-default");
  });

  it("refuses a value that is no address, and a Git host with no login app, before any request leaves", async () => {
    await expectRefusal(start(alice, { address: "not an address" }), Code.InvalidArgument, "is not an address");
    await expectRefusal(
      start(alice, { address: "gitlab.example.com" }),
      Code.FailedPrecondition,
      "nothing can sign in to gitlab.example.com: no login app serves this Git host. Add a login app for gitlab.example.com in Settings, or paste a token",
    );
    expect(rig.requests).toEqual([]);
  });

  it("refuses an app pending its vendor's approval, saying what to do", async () => {
    await seedOrganizationApp(rig, { approval: VendorApprovalStatus.PENDING });
    await expectRefusal(start(alice), Code.FailedPrecondition, "is pending approval by the vendor. Paste a token instead");
  });

  it("refuses an app its vendor rejected, saying what to do", async () => {
    await seedOrganizationApp(rig, { approval: VendorApprovalStatus.REJECTED });
    await expectRefusal(start(alice), Code.FailedPrecondition, "is rejected by the vendor. Paste a token instead");
  });

  it("refuses an app whose stored login endpoints are neither https nor loopback http, before the browser is sent anywhere", async () => {
    await seedOrganizationApp(rig, { authorizationUrl: "javascript:alert(document.domain)//" });
    await expectRefusal(
      start(alice),
      Code.FailedPrecondition,
      "the login app for 'Vendor': its authorization URL must be an https URL (http only for localhost, 127.0.0.1 or [::1])",
    );
    rig.close();
    rig = openSignInRig();
    await seedOrganizationApp(rig, { userinfoUrl: "http://login.vendor.example/me" });
    await expectRefusal(start(alice), Code.FailedPrecondition, "its user-info URL must be an https URL");
  });
});

describe("a sign-in into My vault", () => {
  it("is refused at start for a caller who may keep no My vault in the organization", async () => {
    await seedOrganizationApp(rig);
    rig.levers.denyMyVault = true;
    await expectRefusal(
      start(alice),
      Code.PermissionDenied,
      "unauthorized to keep a My vault in this organization: only its members do",
    );
    expect(await rig.vaults.findMine(ORG, alice.identityId)).toBeUndefined();
    expect(rig.requests).toEqual([]);
  });

  it("is refused at completion when can_create_vault was lost after start, before any My vault or token", async () => {
    await seedOrganizationApp(rig);
    const started = await start(alice);
    rig.levers.denyMyVault = true;
    await expectRefusal(
      complete(alice, started.state),
      Code.PermissionDenied,
      "unauthorized to keep a My vault in this organization: only its members do",
    );
    expect(await rig.vaults.findMine(ORG, alice.identityId)).toBeUndefined();
    expect(tokenRequests()).toEqual([]);
  });
});

describe("a sign-in into a named shared vault", () => {
  it("is refused without can_edit on the vault", async () => {
    await seedOrganizationApp(rig);
    const shared = await seedSharedVault(rig);
    rig.levers.denyVaultEdit = true;
    await expectRefusal(start(alice, { vaultId: shared }), Code.PermissionDenied, "unauthorized to save a sign-in in this vault");
  });

  it("answers NOT_FOUND for a vault of another organization", async () => {
    await seedOrganizationApp(rig);
    const shared = await seedSharedVault(rig);
    await expectRefusal(start(alice, { vaultId: shared, org: OTHER_ORG }), Code.NotFound, "vault not found");
  });

  it("lands in the shared vault, not the signer's My vault, when the signer may edit it", async () => {
    await seedOrganizationApp(rig);
    const shared = await seedSharedVault(rig);
    await signIn(alice, { access: "at-team", refresh: "rt-team" }, shared);
    expect(await vaultLogin(rig, shared, VENDOR_ADDRESS)).toBe("at-team");
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBeUndefined();
  });

  it("refuses at completion a shared vault deleted after the sign-in started, before the code is spent", async () => {
    await seedOrganizationApp(rig);
    const shared = await seedSharedVault(rig);
    const started = await start(alice, { vaultId: shared });
    await rig.store.deleteResource(ApiResourceKind.vault, shared);
    await expectRefusal(complete(alice, started.state), Code.NotFound, shared);
    expect(tokenRequests()).toEqual([]);
    expect(await rig.vaults.findMine(ORG, alice.identityId)).toBeUndefined();
  });

  it("is refused at completion when can_edit was revoked after start", async () => {
    await seedOrganizationApp(rig);
    const shared = await seedSharedVault(rig);
    const started = await start(alice, { vaultId: shared });
    rig.levers.denyVaultEdit = true;
    await expectRefusal(complete(alice, started.state), Code.PermissionDenied, "unauthorized to save a sign-in in this vault");
    expect(tokenRequests()).toEqual([]);
  });

  it("a teammate's sign-in answered without a refresh token never inherits the previous signer's", async () => {
    await seedOrganizationApp(rig);
    const shared = await seedSharedVault(rig);
    const sharedLogin = async () =>
      (await rig.vaults.open((await rig.vaults.findById(shared))!)).connections.get(VENDOR_ADDRESS)!;

    await signIn(alice, { access: "at-alice-1", refresh: "rt-alice" }, shared);
    await signIn(alice, { access: "at-alice-2", refresh: "" }, shared);
    expect((await sharedLogin()).signIn?.refreshToken).toBe("rt-alice");

    await signIn(ben, { access: "at-ben", refresh: "" }, shared);
    const login = await sharedLogin();
    expect(login.token).toBe("at-ben");
    expect(login.signIn?.refreshToken).toBe("");
  });

  it("a full vault refuses a new login before the exchange, and still takes a re-sign-in in place", async () => {
    await seedOrganizationApp(rig);
    const shared = await seedSharedVault(rig);
    const fill: Record<string, { value: string; description: string }> = {};
    for (let i = 0; i < MAX_VAULT_ENTRIES; i++) {
      fill[`SECRET_${i}`] = { value: `v${i}`, description: "" };
    }
    await rig.vaults.setSecrets(shared, fill, alice);
    const started = await start(alice, { vaultId: shared });
    await expectRefusal(
      complete(alice, started.state),
      Code.FailedPrecondition,
      `a vault holds at most ${MAX_VAULT_ENTRIES} logins and secrets together`,
    );
    expect(tokenRequests()).toEqual([]);

    await rig.vaults.removeSecrets(shared, ["SECRET_0"], alice);
    await signIn(alice, { access: "at-1", refresh: "rt-1" }, shared);
    await signIn(alice, { access: "at-2", refresh: "rt-2" }, shared);
    const spec = (await rig.vaults.findById(shared))?.spec;
    expect(Object.keys(spec?.secrets ?? {}).length + Object.keys(spec?.connections ?? {}).length).toBe(MAX_VAULT_ENTRIES);
    expect(await vaultLogin(rig, shared, VENDOR_ADDRESS)).toBe("at-2");
  });
});

describe("the saved login's description and the redirect", () => {
  it("names the account the login app's endpoint answers, else the host", async () => {
    await seedOrganizationApp(rig, { userinfoUrl: "https://login.vendor.example/userinfo" });
    rig.levers.account = { login: "ana", email: "ana@example.com" };
    const named = await complete(alice, (await start(alice)).state);
    expect(named).toMatchObject({ address: VENDOR_ADDRESS, description: "Vendor @ana" });
    const userinfo = rig.requestsTo("https://login.vendor.example/userinfo")[0]!;
    expect(userinfo.headers.get("authorization")).toBe("Bearer at-default");

    rig.levers.account = { email: "ana@example.com" };
    expect((await complete(alice, (await start(alice)).state)).description).toBe("Vendor ana@example.com");

    rig.levers.account = undefined;
    expect((await complete(alice, (await start(alice)).state)).description).toBe("Signed in at mcp.vendor.example");
  });

  it("builds the console's callback, the desktop bridge's, or a loopback page, and records it for the exchange", async () => {
    await seedOrganizationApp(rig);
    const redirectOf = (started: StartSignInOutput) => new URL(started.authorizationUrl).searchParams.get("redirect_uri");
    expect(redirectOf(await start(alice, { returnTo: SignInReturn.web }))).toBe(REDIRECT_URI);
    expect(redirectOf(await start(alice, { returnTo: SignInReturn.desktop }))).toBe(`${REDIRECT_URI}?source=desktop`);
    const loopback = await start(alice, { returnTo: SignInReturn.loopback, loopbackPort: 17237 });
    expect(redirectOf(loopback)).toBe("http://127.0.0.1:17237/auth/oauth/callback");
    await complete(alice, loopback.state);
    expect(new URLSearchParams(tokenRequests()[0]!.body).get("redirect_uri")).toBe(
      "http://127.0.0.1:17237/auth/oauth/callback",
    );
  });
});

describe("McpServer's status and disconnect read the caller's sign-in at the server's address", () => {
  async function seedServer(url = VENDOR_ADDRESS): Promise<void> {
    await rig.store.saveResource(
      ApiResourceKind.mcp_server,
      "mcps_vendor",
      McpServerSchema,
      create(McpServerSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "McpServer",
        metadata: { id: "mcps_vendor", name: "Vendor", slug: "vendor", org: ORG },
        spec: {
          serverType: { case: "http", value: { url } },
          auth: { targetEnvVar: "VENDOR_TOKEN" },
          env: { VENDOR_TOKEN: { isSecret: true } },
        },
      }),
    );
  }
  function connectDeps(): McpServerConnectDeps {
    const unused = <T extends object>(name: string): T =>
      new Proxy({} as T, {
        get(_target, prop) {
          throw new Error(`${name}.${String(prop)} reached by a sign-in read`);
        },
      });
    const deps = rig.deps();
    return {
      store: deps.store,
      logger: silentLogger,
      authorizer: deps.authorizer,
      engineState: unused("engineState"),
      runnerAuth: unused("runnerAuth"),
      vaults: rig.vaults,
      vaultResolver: unused("vaultResolver"),
      sandboxLane: { enabled: false },
      outboundFetch: deps.outboundFetch,
    };
  }
  const status = (caller: CallerIdentity) =>
    getOAuthGrantStatus(connectDeps(), create(GetOAuthGrantStatusInputSchema, { resourceId: "mcps_vendor", org: ORG }), caller);
  const disconnect = (caller: CallerIdentity) =>
    disconnectOAuth(connectDeps(), create(DisconnectOAuthInputSchema, { resourceId: "mcps_vendor", org: ORG }), caller);

  it("a sign-in started at the address is connected for its signer, absent for a teammate; a teammate's disconnect leaves it", async () => {
    await seedOrganizationApp(rig);
    await seedServer();
    await signIn(alice, { access: "at-alice", refresh: "rt-alice" });

    const hers = await status(alice);
    expect(hers.connected).toBe(true);
    expect(hers.targetEnvVar).toBe("VENDOR_TOKEN");
    expect(hers.authMethod).toBe("vendor_oauth");
    expect(hers.connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_HEALTHY);

    expect((await status(ben)).connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
    expect((await disconnect(ben)).disconnected).toBe(false);
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("at-alice");

    expect((await disconnect(alice)).disconnected).toBe(true);
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBeUndefined();
    expect((await disconnect(alice)).disconnected).toBe(false);
  });

  it("health reads the sign-in record: expired with a refresh token is refreshable, without one expired", async () => {
    await seedServer();
    const mine = await rig.vaults.ensureMine(ORG, alice);
    const saveExpired = (refreshToken: string) =>
      rig.vaults.setConnection(
        mine.metadata!.id,
        VENDOR_ADDRESS,
        {
          token: "at-old",
          source: VaultConnectionSource.sign_in,
          signIn: {
            expiresAt: BigInt(Math.floor(Date.now() / 1000) - 3600),
            clientId: "vendor-client",
            authMethod: "vendor_oauth",
            tokenEndpoint: VENDOR_TOKEN_URL,
            refreshToken,
            loginApp: "org:oap_vendor",
          },
        },
        alice,
      );
    await saveExpired("rt-old");
    expect((await status(alice)).connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED_REFRESHABLE);
    await saveExpired("");
    expect((await status(alice)).connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_TOKEN_EXPIRED);
  });

  it("a pasted login at the address is no sign-in: status answers NO_GRANT and disconnect leaves it", async () => {
    await seedServer();
    const mine = await rig.vaults.ensureMine(ORG, alice);
    await rig.vaults.setConnection(mine.metadata!.id, VENDOR_ADDRESS, { token: "pasted", source: VaultConnectionSource.pasted }, alice);
    expect((await status(alice)).connected).toBe(false);
    expect((await disconnect(alice)).disconnected).toBe(false);
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("pasted");
  });

  it("a sign-in at another address is not the server's: a server moved elsewhere reads NO_GRANT and disconnect leaves it", async () => {
    await seedOrganizationApp(rig);
    await seedServer();
    await signIn(alice, { access: "at-alice", refresh: "rt-alice" });
    await seedServer("https://mcp.vendor.example/v2/mcp");
    expect((await status(alice)).connectionHealth).toBe(OAuthConnectionHealth.OAUTH_CONNECTION_HEALTH_NO_GRANT);
    expect((await disconnect(alice)).disconnected).toBe(false);
    expect(await myLogin(rig, alice, VENDOR_ADDRESS)).toBe("at-alice");
  });

  it("answers NOT_FOUND for a server that does not exist", async () => {
    await expectRefusal(
      getOAuthGrantStatus(connectDeps(), create(GetOAuthGrantStatusInputSchema, { resourceId: "mcps_missing", org: ORG }), alice),
      Code.NotFound,
      "mcps_missing",
    );
    await expectRefusal(disconnect(alice), Code.NotFound, "mcps_vendor");
  });
});

describe("renewal writes through the vault", () => {
  const freshener = (loginProviders = new Map<string, { clientId: string; clientSecret: string }>()) =>
    newSignInFreshener({
      vaults: rig.vaults,
      store: rig.store,
      secretService: rig.secretService,
      loginProviders,
      logger: silentLogger,
      fetchImpl: rig.deps().outboundFetch,
    });
  const expired = () => BigInt(Math.floor(Date.now() / 1000) - 10);

  async function savedSignIn(
    expiresAt: bigint,
    refreshToken: string,
    init: { loginApp?: string; address?: string; tokenEndpoint?: string; clientId?: string; authMethod?: string } = {},
  ) {
    const mine = await rig.vaults.ensureMine(ORG, alice);
    const address = init.address ?? VENDOR_ADDRESS;
    const written = await rig.vaults.setConnection(
      mine.metadata!.id,
      address,
      {
        token: "at-old",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt,
          clientId: init.clientId ?? "vendor-client",
          authMethod: init.authMethod ?? "vendor_oauth",
          tokenEndpoint: init.tokenEndpoint ?? VENDOR_TOKEN_URL,
          refreshToken,
          loginApp: init.loginApp ?? "org:oap_vendor",
        },
      },
      alice,
    );
    return { vault: written, connection: (await rig.vaults.open(written)).connections.get(address)! };
  }

  it("renews an expired sign-in with its app's credentials and saves the new token and rotated refresh token", async () => {
    await seedOrganizationApp(rig);
    const { vault, connection } = await savedSignIn(expired(), "rt-old");
    rig.levers.tokenBodies.push({ body: { access_token: "at-new", refresh_token: "rt-new", expires_in: 3600 } });

    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-new");

    const request = tokenRequests()[0]!;
    const form = new URLSearchParams(request.body);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("rt-old");
    expect(form.has("resource")).toBe(false);
    expect(request.headers.get("authorization")).toBe(`Basic ${Buffer.from("vendor-client:vendor-secret").toString("base64")}`);
    const saved = (await rig.vaults.open((await rig.vaults.findMine(ORG, alice.identityId))!)).connections.get(VENDOR_ADDRESS)!;
    expect(saved.token).toBe("at-new");
    expect(saved.signIn?.refreshToken).toBe("rt-new");
    expect(saved.signIn?.loginApp).toBe("org:oap_vendor");
  });

  it("renews a catalog entry's sign-in with the deployment's settings", async () => {
    const { vault, connection } = await savedSignIn(expired(), "rt-old", {
      loginApp: "stigmer:github",
      address: "github.com",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: "gh-client",
    });
    // The rig's fetch answers no GitHub endpoint: the request it records is the proof.
    await freshener(new Map([["github", { clientId: "gh-client", clientSecret: "gh-secret" }]]))
      .freshToken(vault, connection, alice)
      .catch(() => undefined);
    const request = rig.requestsTo("https://github.com/login/oauth/access_token")[0]!;
    expect(new URLSearchParams(request.body).get("client_secret")).toBe("gh-secret");
    expect(request.headers.has("authorization")).toBe(false);
  });

  it("sends resource on a public client's renewal, as its sign-in did", async () => {
    const { vault, connection } = await savedSignIn(expired(), "rt-old", {
      loginApp: "",
      authMethod: "mcp_oauth",
      address: "https://mcp.linear.example/mcp",
      tokenEndpoint: "https://login.linear.example/token",
      clientId: "dcr-client",
    });
    rig.levers.tokenBodies.push({ body: { access_token: "at-new", expires_in: 3600 } });
    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-new");
    const request = rig.requestsTo("https://login.linear.example/token")[0]!;
    expect(new URLSearchParams(request.body).get("resource")).toBe("https://mcp.linear.example/mcp");
    expect(request.headers.has("authorization")).toBe(false);
  });

  it("renews a login app's sign-in saved before apps were recorded through the app its address finds, and records it", async () => {
    await seedOrganizationApp(rig);
    const { vault, connection } = await savedSignIn(expired(), "rt-old", { loginApp: "" });
    rig.levers.tokenBodies.push({ body: { access_token: "at-new", expires_in: 3600 } });

    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-new");

    const request = tokenRequests()[0]!;
    expect(new URLSearchParams(request.body).has("resource")).toBe(false);
    expect(request.headers.get("authorization")).toBe(`Basic ${Buffer.from("vendor-client:vendor-secret").toString("base64")}`);
    const saved = (await rig.vaults.open((await rig.vaults.findMine(ORG, alice.identityId))!)).connections.get(VENDOR_ADDRESS)!;
    expect(saved.signIn?.loginApp).toBe("org:oap_vendor");
  });

  it("renews such a sign-in with no secret and no resource when the app at its address is another client", async () => {
    await seedOrganizationApp(rig, { clientId: "another-client" });
    const { vault, connection } = await savedSignIn(expired(), "rt-old", { loginApp: "" });
    rig.levers.tokenBodies.push({ body: { access_token: "at-new", expires_in: 3600 } });

    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-new");

    const request = tokenRequests()[0]!;
    expect(new URLSearchParams(request.body).has("resource")).toBe(false);
    expect(request.headers.has("authorization")).toBe(false);
    const saved = (await rig.vaults.open((await rig.vaults.findMine(ORG, alice.identityId))!)).connections.get(VENDOR_ADDRESS)!;
    expect(saved.signIn?.loginApp).toBe("");
  });

  it("a renewal of a login replaced since it was read leaves the newer login in place", async () => {
    await seedOrganizationApp(rig);
    const { vault, connection } = await savedSignIn(expired(), "rt-old");
    await rig.vaults.setConnection(
      vault.metadata!.id,
      VENDOR_ADDRESS,
      {
        token: "at-fresh-sign-in",
        source: VaultConnectionSource.sign_in,
        signIn: { ...connection.signIn!, refreshToken: "rt-fresh", expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600) },
      },
      alice,
    );
    rig.levers.tokenBodies.push({ body: { access_token: "at-renewed", refresh_token: "rt-renewed", expires_in: 3600 } });
    expect(await freshener().freshToken(vault, connection, alice)).toBe("at-renewed");
    const saved = (await rig.vaults.open((await rig.vaults.findMine(ORG, alice.identityId))!)).connections.get(VENDOR_ADDRESS)!;
    expect(saved.token).toBe("at-fresh-sign-in");
  });

  it("uses a sign-in that has not expired as it is, and refuses an expired one with no refresh token", async () => {
    await seedOrganizationApp(rig);
    const fresh = await savedSignIn(BigInt(Math.floor(Date.now() / 1000) + 3600), "rt-old");
    expect(await freshener().freshToken(fresh.vault, fresh.connection, alice)).toBe("at-old");
    expect(tokenRequests()).toEqual([]);
    const stale = await savedSignIn(expired(), "");
    await expect(freshener().freshToken(stale.vault, stale.connection, alice)).rejects.toThrow(
      "it has expired and no refresh token is available",
    );
  });

  it("renews without a secret when the app cannot be read: gone, switched off, or its secret unopenable", async () => {
    const cases: Array<{ seed: () => Promise<void>; loginApp: string }> = [
      { seed: async () => {}, loginApp: "org:oap_gone" },
      { seed: async () => {}, loginApp: "stigmer:github" },
      { seed: async () => {}, loginApp: "stigmer:unknown" },
      {
        seed: async () => {
          await seedOrganizationApp(rig);
          const app = await rig.store.getResource(ApiResourceKind.oauth_app, "oap_vendor", OAuthAppSchema);
          app.spec!.clientSecret = "enc:v1:bm90LWEtcmVhbC1jaXBoZXJ0ZXh0";
          await rig.store.saveResource(ApiResourceKind.oauth_app, "oap_vendor", OAuthAppSchema, app);
        },
        loginApp: "org:oap_vendor",
      },
    ];
    for (const [index, c] of cases.entries()) {
      await c.seed();
      const { vault, connection } = await savedSignIn(expired(), "rt-old", { loginApp: c.loginApp });
      rig.levers.tokenBodies.push({ body: { access_token: `at-${index}`, expires_in: 3600 } });
      expect(await freshener().freshToken(vault, connection, alice)).toBe(`at-${index}`);
      const request = tokenRequests()[index]!;
      expect(new URLSearchParams(request.body).get("client_id")).toBe("vendor-client");
      expect(request.headers.has("authorization")).toBe(false);
      expect(new URLSearchParams(request.body).has("client_secret")).toBe(false);
    }
  });

  it("never sends the secret of an app repointed at another client or token URL", async () => {
    const apps = [
      { clientId: "other-client", tokenUrl: VENDOR_TOKEN_URL },
      { clientId: "vendor-client", tokenUrl: "https://login.other.example/token" },
    ];
    for (const [index, other] of apps.entries()) {
      await seedOrganizationApp(rig, { clientId: other.clientId, tokenUrl: other.tokenUrl });
      const { vault, connection } = await savedSignIn(expired(), "rt-old");
      rig.levers.tokenBodies.push({ body: { access_token: `at-${index}`, expires_in: 3600 } });
      expect(await freshener().freshToken(vault, connection, alice)).toBe(`at-${index}`);
      const request = tokenRequests()[index]!;
      expect(new URLSearchParams(request.body).get("client_id")).toBe("vendor-client");
      expect(request.headers.has("authorization")).toBe(false);
    }
  });
});
