// Conformance suite for a sign-in at an address (Class A).
// Domain: agentic / vault — the sign-in facet.
//
// The contract: a person starts a sign-in from an ADDRESS (a tool's URL or a
// Git host) on the vault, never from a tool, and the login is saved at that
// address in the vault they named (VaultCommandController.startSignIn and
// completeSignIn). Which client signs in is found by the address, in one
// order, and every arm of the order is pinned here:
//
//   1. the organization's own OAuthApp listing the address wins;
//   2. else Stigmer's built-in login app for the address (GitHub's serves
//      github.com and GitHub's MCP endpoint), ahead of any discovery;
//   3. else, for a tool's URL only, the address's own login server, found by
//      the RFC 9728 walk from the address: a protected-resource document
//      counts only when it names the address it describes (one naming
//      another resource is discarded), and Stigmer registers ONE public
//      client per login server (two sign-ins at one address, and sign-ins at
//      two addresses behind one login server, share it), registering again
//      once when the login server has forgotten it;
//   4. else a refusal naming the address. A bare Git host with no app is
//      refused without any discovery.
//
// A sign-in through a discovered login server names the address as its
// `resource` (RFC 8707) on the authorization request and the token request;
// one through a login app names none. The redirect is the server's own
// choice of three forms (web, desktop bridge, loopback port), never a URL
// the caller writes.
//
// Completion: only the signer finishes, the state is single-use, the code is
// exchanged with the PKCE verifier, and the login replaces whatever the
// vault holds at the address (a pasted login included). A login app with an
// account endpoint describes the login by the account.
//
// Out of scope here: a Client ID Metadata Document (the server under test
// offers one only on a public https origin, which no hermetic target has; the
// server's unit suite pins it), the run and connect use of the saved login
// (suites-execution/mcpserver-connect.conformance.test.ts), and Connect
// links (vault-connect-link.conformance.test.ts).
//
// Every network counterparty is the suite-owned mock login server
// (test/support/src/oauth-authorization-server.ts), which serves the
// protected-resource documents of the addresses on its own origin.
import { Code } from "@connectrpc/connect";
import { VaultConnectionSource } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { SignInReturn } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { TokenEndpointAuthMethod, VendorApprovalStatus } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { MockOAuthAuthorizationServer } from "@stigmer/test-support/oauth-authorization-server";
import { HERMETIC_OAUTH_REDIRECT_URI } from "@stigmer/test-support/server-process";
import { uniqueName } from "../support/naming";
import { makeOAuthApp, type OAuthAppOptions } from "../support/oauthapps";
import { makeSharedVault, myVaultTarget, setConnectionInput, vaultTarget } from "../support/vaults";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();
const mockAs = new MockOAuthAuthorizationServer();
// A second login server: the one a borrowed protected-resource document
// names, which a sign-in must never reach.
const otherAs = new MockOAuthAuthorizationServer();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  await mockAs.start();
  await otherAs.start();
});

afterEach(async () => {
  mockAs.reset();
  otherAs.reset();
  await fixtures.cleanup();
});

afterAll(async () => {
  await mockAs.close();
  await otherAs.close();
  await target?.teardown();
});

// The host segment of the harness redirect URI, as the pre-flight rejection
// copy renders it.
const REDIRECT_CALLBACK_HOST = new URL(HERMETIC_OAUTH_REDIRECT_URI).host;

// An address on the mock login server's origin, whose protected-resource
// document names the mock as its login server.
function discoveredAddress(): string {
  return mockAs.resourceAddress(uniqueName("tool"));
}

function hostOf(address: string): string {
  return new URL(address).host;
}

async function createApp(org: string, opts: OAuthAppOptions = {}) {
  const app = await clients.oauthAppCommand.create(
    makeOAuthApp(org, uniqueName("login-app"), { tokenUrl: mockAs.tokenEndpoint(), ...opts }),
  );
  fixtures.defer(() => clients.oauthAppCommand.delete({ resourceId: app.metadata!.id }));
  return app;
}

async function createSharedVault(org: string) {
  const vault = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("signin-vault") }));
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: vault.metadata!.id }));
  return vault;
}

// Reads My vault after a sign-in saved into it, and removes it with the test.
async function myVault(org: string) {
  const mine = await clients.vaultQuery.getMine({ org });
  fixtures.defer(() => clients.vaultCommand.delete({ resourceId: mine.metadata!.id }));
  return mine;
}

describe("vault sign-in conformance — the request's own rules", () => {
  it("[rpc:VaultCommandController.startSignIn] refuses a value that names no address, and a loopback return without its port or a port without loopback (InvalidArgument each)", async () => {
    const { org } = await target.provisionTenancy();
    // A value pasted in the wrong field may be a credential.
    const pasted = "ghp_conformanceLooksLikeAToken";
    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: pasted }),
      Code.InvalidArgument,
      "startSignIn with a value that names no address",
    );
    expect(err.rawMessage).toContain("is not an address");
    expect(err.rawMessage, "the input is never repeated").not.toContain(pasted);

    await expectGrpcCode(
      () =>
        clients.vaultCommand.startSignIn({
          vault: myVaultTarget(org),
          address: "github.com",
          returnTo: SignInReturn.loopback,
        }),
      Code.InvalidArgument,
      "loopback return without a port",
    );
    await expectGrpcCode(
      () =>
        clients.vaultCommand.startSignIn({
          vault: myVaultTarget(org),
          address: "github.com",
          returnTo: SignInReturn.web,
          loopbackPort: 17237,
        }),
      Code.InvalidArgument,
      "a port beside the web return",
    );
  });

  it("[rpc:VaultCommandController.startSignIn] answers NotFound for a vault the organization does not hold", async () => {
    const { org } = await target.provisionTenancy();
    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: vaultTarget(org, "vlt_doesnotexist"), address: "github.com" }),
      Code.NotFound,
      "startSignIn into an unknown vault",
    );
    expect(err.rawMessage).toBe("vault not found: vlt_doesnotexist");
  });
});

describe("vault sign-in conformance — the address's own login server", () => {
  it("[rpc:VaultCommandController.startSignIn] walks RFC 9728 from the address, registers a public client, and sends PKCE S256 and the address as resource", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    mockAs.resourceScopesSupported = ["issues:read", "issues:write"];

    const out = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    expect(out.state).not.toBe("");
    expect(out.providerName, "a discovered login server is named by the address's host").toBe(hostOf(address));
    expect(out.scopes, "the address's own scopes come first").toEqual(["issues:read", "issues:write"]);

    // The walk: the address's own document, then its login server's.
    expect(mockAs.capturedProtectedResourcePaths()[0]).toBe(
      `/.well-known/oauth-protected-resource${new URL(address).pathname}`,
    );
    expect(mockAs.capturedDiscoveryPaths()).toEqual([
      `/.well-known/oauth-authorization-server${new URL(mockAs.issuer()).pathname}`,
    ]);

    expect(mockAs.capturedDcrRequests()).toHaveLength(1);
    const dcr = mockAs.capturedDcrRequests()[0]!;
    expect(dcr.client_name).toBe("Stigmer");
    expect(dcr.token_endpoint_auth_method).toBe("none");
    expect(dcr.redirect_uris).toEqual([HERMETIC_OAUTH_REDIRECT_URI]);

    const url = new URL(out.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe(mockAs.authorizationEndpoint());
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("mock-dcr-client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(HERMETIC_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).not.toBeNull();
    expect(url.searchParams.get("state")).toBe(out.state);
    expect(url.searchParams.get("scope")).toBe("issues:read issues:write");
    expect(url.searchParams.get("resource"), "the token is asked for this address only").toBe(address);

    // The pre-flight probe fetched exactly that URL server-side.
    expect(mockAs.capturedAuthorizeProbes()).toHaveLength(1);
    expect(mockAs.capturedAuthorizeProbes()[0]!.params.get("resource")).toBe(address);
  });

  it("[rpc:VaultCommandController.startSignIn] falls back to the login server's scopes_supported when the address lists none", async () => {
    const { org } = await target.provisionTenancy();
    mockAs.scopesSupported = ["discovered:a", "discovered:b"];
    const out = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: discoveredAddress() });
    expect(out.scopes).toEqual(["discovered:a", "discovered:b"]);
    expect(new URL(out.authorizationUrl).searchParams.get("scope")).toBe("discovered:a discovered:b");
  });

  it("[rpc:VaultCommandController.startSignIn] registers one client per login server: two sign-ins at one address and one at a second address behind the same login server share it", async () => {
    const { org } = await target.provisionTenancy();
    const first = discoveredAddress();
    const second = discoveredAddress();

    const outs = [
      await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: first }),
      await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: first }),
      await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: second }),
    ];

    expect(mockAs.capturedDcrRequests(), "one registration for the login server").toHaveLength(1);
    for (const out of outs) {
      expect(new URL(out.authorizationUrl).searchParams.get("client_id")).toBe("mock-dcr-client-1");
    }
    expect(new URL(outs[2]!.authorizationUrl).searchParams.get("resource")).toBe(second);
  });

  it("[rpc:VaultCommandController.startSignIn] registers again, once, when the login server has forgotten the kept client", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
    mockAs.forgetClient("mock-dcr-client-1");

    const again = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    expect(mockAs.capturedDcrRequests(), "one new registration").toHaveLength(2);
    expect(new URL(again.authorizationUrl).searchParams.get("client_id")).toBe("mock-dcr-client-2");
    // The forgotten client was probed and refused once, the new one admitted.
    expect(mockAs.capturedAuthorizeProbes().map((p) => p.params.get("client_id"))).toEqual([
      "mock-dcr-client-1",
      "mock-dcr-client-1",
      "mock-dcr-client-2",
    ]);

    // The new client is kept: the next sign-in registers nothing.
    await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
    expect(mockAs.capturedDcrRequests()).toHaveLength(2);
  });

  it("[rpc:VaultCommandController.startSignIn] discards a protected-resource document that names another resource, so the address's origin is its login server", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    // The address's origin serves a document borrowed from another
    // resource, naming another login server.
    mockAs.protectedResourceName = "https://mcp.elsewhere.test/mcp";
    mockAs.protectedResourceIssuers = [otherAs.issuer()];

    const out = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    expect(`${new URL(out.authorizationUrl).origin}`).toBe(mockAs.origin());
    expect(otherAs.capturedDiscoveryPaths(), "the borrowed document's login server is never asked").toEqual([]);
    expect(otherAs.capturedDcrRequests()).toEqual([]);

    // Control: the same document naming the address itself does lead there.
    mockAs.protectedResourceName = undefined;
    const followed = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: discoveredAddress() });
    expect(new URL(followed.authorizationUrl).origin).toBe(otherAs.origin());
  });

  it("[rpc:VaultCommandController.startSignIn] refuses a login server that registers no clients, naming the address and what helps", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    mockAs.omitRegistrationEndpoint = true;
    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address }),
      Code.FailedPrecondition,
      "startSignIn at a login server without registration",
    );
    expect(err.rawMessage).toBe(
      `nothing can sign in to ${address}: ${new URL(mockAs.origin()).host} does not allow automatic client registration. ` +
        `Add a login app for ${address} in Settings, or paste a token`,
    );
  });

  it("[rpc:VaultCommandController.startSignIn] refuses an address whose login server cannot be discovered, naming the document that failed", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    mockAs.discoveryStatus = 503;
    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address }),
      Code.FailedPrecondition,
      "startSignIn with failing discovery",
    );
    expect(err.rawMessage).toBe(
      `nothing can sign in to ${address}: authorization server discovery failed: ` +
        `${mockAs.origin()}/.well-known/oauth-authorization-server${new URL(mockAs.issuer()).pathname} returned HTTP 503 (expected 200). ` +
        "This MCP server may not support the MCP Authorization specification. " +
        `Add a login app for ${address} in Settings, or paste a token`,
    );
  });

  it("[rpc:VaultCommandController.startSignIn] refuses when the authorize pre-flight answers 400 for a fresh client, with the pinned rejection copy", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    mockAs.authorizeStatus = 400;
    mockAs.authorizeErrorBody = { error: "invalid_request", error_description: "redirect host not allowed" };
    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address }),
      Code.FailedPrecondition,
      "startSignIn with pre-flight 400",
    );
    expect(err.rawMessage).toBe(
      `${hostOf(address)} rejected the sign-in request before showing a login page (HTTP 400). ` +
        `The most common cause is a redirect-host allowlist: this deployment's OAuth callback host (${REDIRECT_CALLBACK_HOST}) ` +
        "is not on the provider's approved list. Self-hosted deployments with a localhost callback are typically unaffected. " +
        "Provider detail: redirect host not allowed",
    );
    expect(mockAs.capturedDcrRequests(), "a fresh client refused is not registered again").toHaveLength(1);
  });

  it("[rpc:VaultCommandController.startSignIn] fails open when the authorize pre-flight answers a non-400 error (the bot-wall contract)", async () => {
    const { org } = await target.provisionTenancy();
    mockAs.authorizeStatus = 403;
    mockAs.authorizeErrorBody = { error: "forbidden" };
    const out = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: discoveredAddress() });
    expect(out.authorizationUrl).not.toBe("");
  });

  it("[rpc:VaultCommandController.startSignIn] refuses a bare Git host no login app serves, without discovering anything", async () => {
    const { org } = await target.provisionTenancy();
    // The mock's own host and port as a Git host: a discovery would be seen.
    const host = new URL(mockAs.origin()).host;
    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: host }),
      Code.FailedPrecondition,
      "startSignIn at a bare host with no app",
    );
    expect(err.rawMessage).toBe(
      `nothing can sign in to ${host}: no login app serves this Git host. Add a login app for ${host} in Settings, or paste a token`,
    );
    expect(mockAs.capturedProtectedResourcePaths()).toEqual([]);
    expect(mockAs.capturedDiscoveryPaths()).toEqual([]);
  });
});

describe("vault sign-in conformance — login apps for the address", () => {
  it("[rpc:VaultCommandController.startSignIn] the organization's app for the address wins over discovery: its endpoints and client, a custom scope parameter, no resource, nothing discovered", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    await createApp(org, { addresses: [address], scopeParameterName: "user_scope" });

    const out = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    expect(out.providerName).toBe("ConformanceVendor");
    expect(out.scopes).toEqual(["read", "write"]);
    const url = new URL(out.authorizationUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://vendor.example.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("conformance-client-id");
    expect(url.searchParams.get("user_scope")).toBe("read write");
    expect(url.searchParams.get("scope"), "the default parameter name is replaced").toBeNull();
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.has("resource"), "a login app's vendor is never sent resource").toBe(false);
    expect(mockAs.capturedProtectedResourcePaths()).toEqual([]);
    expect(mockAs.capturedDiscoveryPaths()).toEqual([]);
    expect(mockAs.capturedAuthorizeProbes()).toEqual([]);
  });

  it("[rpc:VaultCommandController.startSignIn] the organization's app wins over Stigmer's built-in app, which wins over discovery", async () => {
    const { org } = await target.provisionTenancy();

    // GitHub's MCP endpoint: Stigmer's GitHub app, with no discovery.
    const builtIn = await clients.vaultCommand.startSignIn({
      vault: myVaultTarget(org),
      address: "https://api.githubcopilot.com/mcp",
    });
    expect(builtIn.providerName).toBe("GitHub");
    const builtInUrl = new URL(builtIn.authorizationUrl);
    expect(`${builtInUrl.origin}${builtInUrl.pathname}`).toBe("https://github.com/login/oauth/authorize");

    // An admin adds the organization's own app for github.com: it wins.
    await createApp(org, { addresses: ["github.com"], provider: "Acme GitHub" });
    const own = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: "github.com" });
    expect(own.providerName).toBe("Acme GitHub");
    const ownUrl = new URL(own.authorizationUrl);
    expect(`${ownUrl.origin}${ownUrl.pathname}`).toBe("https://vendor.example.com/oauth/authorize");
  });

  it("[rpc:VaultCommandController.startSignIn] refuses an app its vendor has not approved, with the pinned copy", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    await createApp(org, { addresses: [address], vendorApprovalStatus: VendorApprovalStatus.PENDING });
    const err = await expectGrpcCode(
      () => clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address }),
      Code.FailedPrecondition,
      "startSignIn through a pending app",
    );
    expect(err.rawMessage).toBe(
      "sign-in is unavailable: the organization's OAuth app for 'ConformanceVendor' is pending approval by the vendor. " +
        "Paste a token instead, or ask an admin to use another app",
    );
  });

  it("[rpc:VaultCommandController.startSignIn] builds the return the caller chose: the console's callback, its desktop bridge, or a loopback page", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    await createApp(org, { addresses: [address] });
    const redirectOf = async (returnTo: SignInReturn, loopbackPort = 0) =>
      new URL(
        (await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address, returnTo, loopbackPort }))
          .authorizationUrl,
      ).searchParams.get("redirect_uri");

    expect(await redirectOf(SignInReturn.web)).toBe(HERMETIC_OAUTH_REDIRECT_URI);
    expect(await redirectOf(SignInReturn.sign_in_return_unspecified)).toBe(HERMETIC_OAUTH_REDIRECT_URI);
    expect(await redirectOf(SignInReturn.desktop)).toBe(`${HERMETIC_OAUTH_REDIRECT_URI}?source=desktop`);
    expect(await redirectOf(SignInReturn.loopback, 17237)).toBe("http://127.0.0.1:17237/auth/oauth/callback");
  });
});

describe("vault sign-in conformance — completion", () => {
  it("[rpc:VaultCommandController.completeSignIn] refuses a state the server never issued, and a state already used (FailedPrecondition, pinned copy)", async () => {
    const { org } = await target.provisionTenancy();
    const unknown = await expectGrpcCode(
      () => clients.vaultCommand.completeSignIn({ state: "never-issued-state", code: "code" }),
      Code.FailedPrecondition,
      "completeSignIn with an unknown state",
    );
    expect(unknown.rawMessage).toBe("this sign-in has expired or was already used: start it again");

    const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: discoveredAddress() });
    await clients.vaultCommand.completeSignIn({ state: started.state, code: "first-code" });
    await myVault(org);
    const reused = await expectGrpcCode(
      () => clients.vaultCommand.completeSignIn({ state: started.state, code: "second-code" }),
      Code.FailedPrecondition,
      "completeSignIn with a used state",
    );
    expect(reused.rawMessage).toBe("this sign-in has expired or was already used: start it again");
  });

  it("[rpc:VaultCommandController.completeSignIn] rejects an empty state or code (InvalidArgument)", async () => {
    await expectGrpcCode(
      () => clients.vaultCommand.completeSignIn({ state: "", code: "c" }),
      Code.InvalidArgument,
      "completeSignIn empty state",
    );
    await expectGrpcCode(
      () => clients.vaultCommand.completeSignIn({ state: "s", code: "" }),
      Code.InvalidArgument,
      "completeSignIn empty code",
    );
  });

  it("[rpc:VaultCommandController.completeSignIn] maps a failing token endpoint to Unavailable", async () => {
    const { org } = await target.provisionTenancy();
    const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address: discoveredAddress() });
    mockAs.tokenStatus = 502;
    const err = await expectGrpcCode(
      () => clients.vaultCommand.completeSignIn({ state: started.state, code: "code" }),
      Code.Unavailable,
      "completeSignIn with a failing token endpoint",
    );
    expect(err.rawMessage).toContain("token exchange failed:");
    expect(err.rawMessage).toContain("returned HTTP 502");
  });

  it("[rpc:VaultCommandController.completeSignIn] through a discovered login server: exchanges with the PKCE verifier as a public client, names the address as resource, and saves the login at the address in My vault", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    const done = await clients.vaultCommand.completeSignIn({ state: started.state, code: "conformance-auth-code" });

    expect(done.address).toBe(address);
    expect(done.description).toBe(`Signed in at ${hostOf(address)}`);

    expect(mockAs.capturedTokenRequests()).toHaveLength(1);
    const exchange = mockAs.capturedTokenRequests()[0]!;
    expect(exchange.grantType).toBe("authorization_code");
    expect(exchange.code).toBe("conformance-auth-code");
    expect(exchange.clientId).toBe("mock-dcr-client-1");
    expect(exchange.redirectUri).toBe(HERMETIC_OAUTH_REDIRECT_URI);
    expect(exchange.secretChannel).toBe("none");
    expect(exchange.resource, "the token request names the address too").toBe(address);
    const challenge = new URL(started.authorizationUrl).searchParams.get("code_challenge");
    expect(createHash("sha256").update(exchange.codeVerifier!).digest("base64url")).toBe(challenge);

    const mine = await myVault(org);
    const connection = mine.spec?.connections[address];
    expect(connection?.source).toBe(VaultConnectionSource.sign_in);
    expect(connection?.signIn?.authMethod).toBe("mcp_oauth");
    expect(connection?.signIn?.loginApp, "a public client of the address's own login server").toBe("");
    expect(connection?.token, "a read never shows the token").toBe("");
    expect(connection?.signIn?.refreshToken ?? "", "nor the refresh token").toBe("");
  });

  it("[rpc:VaultCommandController.completeSignIn] through the organization's app: presents the secret via Basic by default, sends no resource, and describes the login by the account", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    const app = await createApp(org, { addresses: [address], userinfoUrl: mockAs.userinfoEndpoint() });
    mockAs.userinfoLogin = "conformance-user";
    const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });

    const done = await clients.vaultCommand.completeSignIn({ state: started.state, code: "vendor-code" });

    expect(done.description).toBe("ConformanceVendor @conformance-user");
    const exchange = mockAs.capturedTokenRequests()[0]!;
    expect(exchange.secretChannel).toBe("basic");
    expect(exchange.clientSecret).toBe("conformance-client-secret");
    expect(exchange.resource).toBeUndefined();
    const connection = (await myVault(org)).spec?.connections[address];
    expect(connection?.signIn?.authMethod).toBe("vendor_oauth");
    expect(connection?.signIn?.loginApp).toBe(`org:${app.metadata!.id}`);
    expect(connection?.description).toBe("ConformanceVendor @conformance-user");
  });

  it("[rpc:VaultCommandController.completeSignIn] saves into the shared vault the sign-in named, presenting the secret in the form on client_secret_post", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    await createApp(org, { addresses: [address], tokenEndpointAuthMethod: TokenEndpointAuthMethod.CLIENT_SECRET_POST });
    const vault = await createSharedVault(org);
    const started = await clients.vaultCommand.startSignIn({ vault: vaultTarget(org, vault.metadata!.id), address });

    await clients.vaultCommand.completeSignIn({ state: started.state, code: "vendor-code" });

    expect(mockAs.capturedTokenRequests()[0]!.secretChannel).toBe("post");
    const saved = await clients.vaultQuery.get({ value: vault.metadata!.id });
    expect(saved.spec?.connections[address]?.source).toBe(VaultConnectionSource.sign_in);
  });

  it("[rpc:VaultCommandController.completeSignIn] replaces whatever the vault holds at the address: a pasted login, then an earlier sign-in", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    await clients.vaultCommand.setConnection(setConnectionInput(myVaultTarget(org), address, "pasted-token"));
    await myVault(org);

    for (const code of ["first-code", "second-code"]) {
      const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
      await clients.vaultCommand.completeSignIn({ state: started.state, code });
    }

    const mine = await clients.vaultQuery.getMine({ org });
    expect(Object.keys(mine.spec?.connections ?? {}), "one login at the address").toEqual([address]);
    expect(mine.spec?.connections[address]?.source).toBe(VaultConnectionSource.sign_in);
  });

  it("[rpc:VaultCommandController.completeSignIn] a client the login server forgot by the exchange is dropped, so the next sign-in registers anew", async () => {
    const { org } = await target.provisionTenancy();
    const address = discoveredAddress();
    const started = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
    mockAs.forgetClient("mock-dcr-client-1");

    const err = await expectGrpcCode(
      () => clients.vaultCommand.completeSignIn({ state: started.state, code: "code" }),
      Code.FailedPrecondition,
      "completeSignIn with a forgotten client",
    );
    expect(err.rawMessage).toBe(`the login server for ${address} no longer knows Stigmer's client: sign in again`);

    const probesBefore = mockAs.capturedAuthorizeProbes().length;
    const again = await clients.vaultCommand.startSignIn({ vault: myVaultTarget(org), address });
    expect(mockAs.capturedDcrRequests()).toHaveLength(2);
    expect(new URL(again.authorizationUrl).searchParams.get("client_id")).toBe("mock-dcr-client-2");
    expect(mockAs.capturedAuthorizeProbes().length - probesBefore, "registered before probing, no refused probe").toBe(1);
  });
});
