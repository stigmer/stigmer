/**
 * Pins how a sign-in and a Connect link answer what goes wrong underneath
 * them, at the handler layer over the rig (support.ts) with one dependency
 * at a time made to fail:
 *
 *   - a login server that refuses to register Stigmer, at the first try or
 *     at the one new registration a forgotten client gets, is reported as a
 *     registration failure naming the address; a pre-flight that cannot
 *     reach the login page proceeds (fail-open);
 *   - a deployment with no console callback refuses a console sign-in and a
 *     Connect link, saying which setting is missing;
 *   - every start sweeps expired pending states;
 *   - a seal or a store that fails while the pending state is recorded, or
 *     while it is read back, answers INTERNAL, and a pending state whose
 *     secrets cannot be opened is refused before any token is asked for;
 *   - a Connect link whose maker's permission cannot be checked, whose vault
 *     is gone, whose spend loses a race, or whose organization cannot be
 *     read answers as it should;
 *   - a claim whose app no longer lists the address is no login app, and a
 *     store fault reading an app propagates.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CompleteConnectLinkInputSchema,
  ConnectLinkTokenInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/connect_link_pb";
import {
  CompleteSignInInputSchema,
  CreateConnectLinkInputSchema,
  StartSignInInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";

import { SecretService } from "../../../../encryption/encryption.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import type { PendingOAuthState, Store } from "../../../../store/interface.js";
import { completeConnectLink, createConnectLink, getConnectLink, startConnectLink } from "../../connect-link.js";
import type { ConnectLinkDeps } from "../../connect-link.js";
import { findLoginApp, loginAppByRef } from "../../login-app.js";
import { loginServerHost } from "../client.js";
import { completePersonSignIn, startPersonSignIn } from "../person.js";
import { sealPendingOAuthState } from "../start.js";
import {
  MCP_ADDRESS,
  ORG,
  REDIRECT_URI,
  VENDOR_ADDRESS,
  alice,
  expectRefusal,
  openSignInRig,
  seedOrganizationApp,
  seedSharedVault,
  silentLogger,
} from "./support.js";
import type { SignInRig } from "./support.js";

let rig: SignInRig;

beforeEach(() => {
  rig = openSignInRig();
});

afterEach(() => {
  rig.close();
});

function start(address: string, deps: Partial<ConnectLinkDeps> = {}) {
  return startPersonSignIn(
    rig.deps(deps),
    create(StartSignInInputSchema, { vault: { org: ORG, vault: { case: "mine", value: true } }, address }),
    alice,
  );
}

function complete(state: string, deps: Partial<ConnectLinkDeps> = {}) {
  return completePersonSignIn(rig.deps(deps), create(CompleteSignInInputSchema, { state, code: "code" }), alice);
}

const fault = (): Promise<never> => Promise.reject(new Error("disk gone"));

/** `target` with some of its methods replaced; the rest answer as the target's own. */
function withOverrides<T extends object>(target: T, overrides: Record<string, unknown>): T {
  return new Proxy(target, {
    get(inner, prop, receiver) {
      if (typeof prop === "string" && prop in overrides) {
        return overrides[prop];
      }
      const value = Reflect.get(inner, prop, receiver) as unknown;
      return typeof value === "function" ? value.bind(inner) : value;
    },
  });
}

/** A store answering every call as the rig's, but `overrides`. */
function storeWith(overrides: Record<string, unknown>): Store {
  return withOverrides<Store>(rig.store, overrides);
}

describe("the login server", () => {
  it("refusing to register Stigmer is reported, naming the address, at the first try and at a forgotten client's one retry", async () => {
    rig.levers.failRegistrations = true;
    await expectRefusal(start(MCP_ADDRESS), Code.FailedPrecondition, `registering Stigmer with the login server for ${MCP_ADDRESS} failed`);

    rig.levers.failRegistrations = false;
    const first = await start(MCP_ADDRESS);
    rig.levers.forgotten.add(new URL(first.authorizationUrl).searchParams.get("client_id")!);
    rig.levers.failRegistrations = true;
    await expectRefusal(start(MCP_ADDRESS), Code.FailedPrecondition, `registering Stigmer with the login server for ${MCP_ADDRESS} failed`);
  });

  it("a fault keeping Stigmer's client is the server's, never blamed on the login server", async () => {
    const registrations = rig.store.oauthClientRegistrations;
    const failing = new Proxy(registrations, {
      get(target, prop, receiver) {
        if (prop === "find") return () => Promise.reject(new Error("disk gone"));
        const value = Reflect.get(target, prop, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const refused = await start(MCP_ADDRESS, { clientRegistrations: failing }).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.Internal);
    expect((refused as ConnectError).rawMessage).not.toContain("registering Stigmer");
  });

  it("a pre-flight that cannot reach the login page proceeds", async () => {
    rig.levers.authorizeUnreachable = true;
    const started = await start(MCP_ADDRESS);
    expect(started.authorizationUrl.startsWith("https://login.linear.example/authorize?")).toBe(true);
  });

  it("is named by its issuer, its login page, or plainly when neither is a URL", () => {
    const metadata = {
      issuer: "",
      authorizationEndpoint: "",
      tokenEndpoint: "",
      registrationEndpoint: "",
      scopesSupported: [],
      codeChallengeMethodsSupported: [],
      clientIdMetadataDocumentSupported: false,
    };
    expect(loginServerHost({ ...metadata, issuer: "https://login.example" })).toBe("login.example");
    expect(loginServerHost({ ...metadata, authorizationEndpoint: "https://auth.example/authorize" })).toBe("auth.example");
    expect(loginServerHost(metadata)).toBe("the login server");
  });
});

describe("a deployment with no console callback", () => {
  it("refuses a console sign-in and a Connect link, naming the setting", async () => {
    await seedOrganizationApp(rig);
    await seedSharedVault(rig);
    await expectRefusal(start(VENDOR_ADDRESS, { oauthRedirectUri: "" }), Code.FailedPrecondition, "STIGMER_OAUTH_REDIRECT_URI is not set");
    await expectRefusal(
      createConnectLink(
        rig.deps({ oauthRedirectUri: "" }),
        create(CreateConnectLinkInputSchema, {
          org: ORG,
          vaultId: "vlt_shared",
          address: VENDOR_ADDRESS,
          returnUrl: "https://helpdesk.example/done",
        }),
        alice,
      ),
      Code.FailedPrecondition,
      "Connect links need the console's address: STIGMER_OAUTH_REDIRECT_URI is not set",
    );
  });
});

describe("recording and reading the pending state", () => {
  it("every start sweeps the states nobody finished, so starts cannot grow the table", async () => {
    await seedOrganizationApp(rig);
    const swept: number[] = [];
    const states = rig.store.pendingOAuthStates;
    const counting = withOverrides(states, {
      cleanupExpired: async () => {
        const removed = await states.cleanupExpired();
        swept.push(removed);
        return removed;
      },
    });
    const recorded = (await states.getAndDelete((await start(VENDOR_ADDRESS)).state))!;
    await states.save({ ...recorded, state: "abandoned", createdAt: Math.floor(Date.now() / 1000) - 11 * 60 });
    await start(VENDOR_ADDRESS, { pendingOAuthStates: counting });
    expect(swept).toEqual([1]);
  });

  it("a seal or a store that fails while the state is recorded answers INTERNAL", async () => {
    await seedOrganizationApp(rig);
    const failingSeal = SecretService.create(Buffer.alloc(32, 3));
    failingSeal.encrypt = fault;
    await expectRefusal(start(VENDOR_ADDRESS, { secretService: failingSeal }), Code.Internal, "");
    await expectRefusal(
      start(VENDOR_ADDRESS, { pendingOAuthStates: withOverrides(rig.store.pendingOAuthStates, { save: fault }) }),
      Code.Internal,
      "",
    );
  });

  it("names which secret could not be sealed", async () => {
    const state: PendingOAuthState = {
      state: "s",
      codeVerifier: "verifier",
      clientId: "c",
      clientSecret: "secret",
      tokenEndpoint: "https://t.example",
      identityAccountId: "ida",
      authMethod: "vendor_oauth",
      tokenAuthMethod: "",
      redirectUri: REDIRECT_URI,
      org: ORG,
      vaultId: "",
      address: VENDOR_ADDRESS,
      loginApp: "",
      resource: "",
      clientRegistration: "",
      connectLink: "",
      providerName: "",
      userinfoUrl: "",
      createdAt: 0,
    };
    const secrets = SecretService.create(Buffer.alloc(32, 3));
    secrets.encrypt = fault;
    await expect(sealPendingOAuthState(secrets, silentLogger, state)).rejects.toThrow("failed to encrypt code_verifier");
    let calls = 0;
    secrets.encrypt = async (value: string) => {
      calls += 1;
      if (calls > 1) throw new Error("disk gone");
      return value;
    };
    await expect(sealPendingOAuthState(secrets, silentLogger, state)).rejects.toThrow("failed to encrypt client_secret");
  });

  it("a store that fails while the state is read back answers INTERNAL, for a person and for a link", async () => {
    await seedOrganizationApp(rig);
    await seedSharedVault(rig);
    const failingRead = withOverrides(rig.store.pendingOAuthStates, { getAndDelete: fault });
    await expectRefusal(complete("any", { pendingOAuthStates: failingRead }), Code.Internal, "");

    const link = await createConnectLink(
      rig.deps(),
      create(CreateConnectLinkInputSchema, { org: ORG, vaultId: "vlt_shared", address: VENDOR_ADDRESS, returnUrl: "https://helpdesk.example/done" }),
      alice,
    );
    const token = link.url.slice(link.url.lastIndexOf("/") + 1);
    await expectRefusal(
      completeConnectLink(
        rig.deps({ pendingOAuthStates: failingRead }),
        create(CompleteConnectLinkInputSchema, { token, state: "any", code: "code" }),
      ),
      Code.Internal,
      "",
    );
  });

  it("a state whose verifier or client secret cannot be opened is refused before any token is asked for", async () => {
    await seedOrganizationApp(rig);
    for (const [name, sealed] of [
      ["verifier", { codeVerifier: "enc:v1:bm90LWEtcmVhbC1jaXBoZXJ0ZXh0" }],
      ["secret", { clientSecret: "enc:v1:bm90LWEtcmVhbC1jaXBoZXJ0ZXh0" }],
    ] as const) {
      const started = await start(VENDOR_ADDRESS);
      const pending = await rig.store.pendingOAuthStates.getAndDelete(started.state);
      await rig.store.pendingOAuthStates.save({ ...pending!, ...sealed, state: `sealed-${name}` });
      await expectRefusal(complete(`sealed-${name}`), Code.Internal, "failed to decrypt OAuth handshake secrets");
    }
    expect(rig.requestsTo("https://login.vendor.example/token")).toEqual([]);
  });
});

describe("a Connect link", () => {
  async function made(): Promise<string> {
    await seedOrganizationApp(rig);
    await seedSharedVault(rig);
    const link = await createConnectLink(
      rig.deps(),
      create(CreateConnectLinkInputSchema, { org: ORG, vaultId: "vlt_shared", address: VENDOR_ADDRESS, returnUrl: "https://helpdesk.example/done" }),
      alice,
    );
    return link.url.slice(link.url.lastIndexOf("/") + 1);
  }
  const tokenInput = (token: string) => create(ConnectLinkTokenInputSchema, { token });

  it("is made by a signed-in caller only", async () => {
    await seedSharedVault(rig);
    await expectRefusal(
      createConnectLink(
        rig.deps(),
        create(CreateConnectLinkInputSchema, { org: ORG, vaultId: "vlt_shared", address: VENDOR_ADDRESS, returnUrl: "https://helpdesk.example/done" }),
        testCallerIdentity({ identityId: "" }),
      ),
      Code.Unauthenticated,
      "a Connect link is made by a signed-in caller",
    );
  });

  it("is refused for an address the organization has no login app for, discovering nothing", async () => {
    await seedSharedVault(rig);
    await expectRefusal(
      createConnectLink(
        rig.deps(),
        create(CreateConnectLinkInputSchema, { org: ORG, vaultId: "vlt_shared", address: "https://nothing.example/mcp", returnUrl: "https://helpdesk.example/done" }),
        alice,
      ),
      Code.FailedPrecondition,
      "a Connect link signs in only through the organization's own login app: add one in Settings that lists https://nothing.example/mcp",
    );
    expect(rig.requests).toEqual([]);
  });

  it("whose vault is gone answers NOT_FOUND at start", async () => {
    const token = await made();
    await rig.store.deleteResource(ApiResourceKind.vault, "vlt_shared");
    await expectRefusal(startConnectLink(rig.deps(), tokenInput(token)), Code.NotFound, "Connect link not found");
  });

  it("whose maker's permission cannot be checked answers INTERNAL", async () => {
    const token = await made();
    const deps = rig.deps({
      authorizer: { authorize: () => Promise.resolve({ kind: "unavailable", cause: new Error("engine down") }) },
    });
    await expectRefusal(startConnectLink(deps, tokenInput(token)), Code.Internal, "");
  });

  it("whose spend loses a race answers NOT_FOUND and saves nothing", async () => {
    const token = await made();
    const state = (await startConnectLink(rig.deps(), tokenInput(token))).state;
    const deps = rig.deps({ connectLinks: withOverrides(rig.store.connectLinks, { spend: () => Promise.resolve(false) }) });
    await expectRefusal(
      completeConnectLink(deps, create(CompleteConnectLinkInputSchema, { token, state, code: "code" })),
      Code.NotFound,
      "Connect link not found",
    );
    expect(rig.requestsTo("https://login.vendor.example/token")).toEqual([]);
  });

  it("names no organization when its organization cannot be found, and propagates any other fault", async () => {
    const token = await made();
    expect((await getConnectLink(rig.deps(), tokenInput(token))).organizationName).toBe("");
    const faulty = storeWith({
      getResource: (kind: ApiResourceKind, ...rest: unknown[]) =>
        kind === ApiResourceKind.organization ? fault() : (rig.store.getResource as (...a: unknown[]) => unknown)(kind, ...rest),
    });
    await expect(getConnectLink(rig.deps({ store: faulty }), tokenInput(token))).rejects.toThrow("disk gone");
  });
});

describe("finding a login app", () => {
  it("ignores a claim whose app no longer lists the address, and propagates a store fault reading the app", async () => {
    await seedOrganizationApp(rig);
    const app = await rig.store.getResource(ApiResourceKind.oauth_app, "oap_vendor", OAuthAppSchema);
    app.spec!.addresses = [];
    await rig.store.saveResource(ApiResourceKind.oauth_app, "oap_vendor", OAuthAppSchema, app);
    expect(await findLoginApp(rig.deps(), ORG, VENDOR_ADDRESS)).toBeUndefined();
    // A recorded login_app of no known shape names no app: the renewal goes without a secret.
    expect(await loginAppByRef(rig.deps(), "elsewhere:oap_vendor")).toBeUndefined();

    await seedOrganizationApp(rig);
    await expect(findLoginApp(rig.deps({ store: storeWith({ getResource: fault }) }), ORG, VENDOR_ADDRESS)).rejects.toThrow("disk gone");
  });
});
