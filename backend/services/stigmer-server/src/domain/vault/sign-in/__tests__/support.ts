/**
 * The handler-layer rig the vault sign-in suites share: a REAL sqlite store
 * and vault service, a table Authorizer with levers, and one outbound fetch
 * standing in for every login server a sign-in reaches (an organization's
 * login app's token endpoint, a discovered login server's documents, its
 * registration and authorize endpoints, and an account endpoint), recording
 * every request so a suite can say what left the server and what did not.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { expect } from "vitest";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import {
  TokenEndpointAuthMethod,
  VendorApprovalStatus,
} from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../../boot/logger.js";
import { SecretService } from "../../../../encryption/encryption.js";
import type { Authorizer, AuthzCheck } from "../../../../extensions/authorizer.js";
import type { CallerIdentity } from "../../../../extensions/identity.js";
import { testCallerIdentity } from "../../../../pipeline/__tests__/support.js";
import { SqliteStore } from "../../../../store/sqlite/store.js";
import type { ConnectLinkDeps } from "../../connect-link.js";
import { oauthAppAddressKey } from "../../login-app.js";
import type { LoginProviderCredentials } from "../../login-providers.js";
import { newVaultService } from "../../service.js";
import type { VaultService } from "../../service.js";

export const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

export const ORG = "org_00000000000000000000000001";
export const OTHER_ORG = "org_00000000000000000000000002";
/** A tool served by an organization's login app. */
export const VENDOR_ADDRESS = "https://mcp.vendor.example/mcp";
export const VENDOR_TOKEN_URL = "https://login.vendor.example/token";
/** A tool whose own login server Stigmer finds and registers with. */
export const MCP_ADDRESS = "https://mcp.linear.example/mcp";
/** Another tool on the same origin, behind the same login server. */
export const OTHER_MCP_ADDRESS = "https://mcp.linear.example/v2/mcp";
const MCP_ORIGIN = "https://mcp.linear.example";
const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";
export const LOGIN_SERVER = "https://login.linear.example";
export const REDIRECT_URI = "http://127.0.0.1:8234/auth/oauth/callback";

export const alice = testCallerIdentity({ identityId: "ida_alice" });
export const ben = testCallerIdentity({ identityId: "ida_ben" });

/** A request a login server received. */
export interface OutboundRequest {
  readonly url: string;
  readonly method: string;
  readonly body: string;
  readonly headers: Headers;
}

/** The levers a test sets before it runs. */
export interface Levers {
  denyVaultEdit: boolean;
  denyVaultEditFor: string | undefined;
  denyMyVault: boolean;
  /** Token responses answered in order; a default token after. */
  tokenBodies: Array<{ readonly status?: number; readonly body: unknown }>;
  /** Runs while a token endpoint answers: after completion's checks, before its save. */
  duringExchange: (() => Promise<void>) | undefined;
  /** The discovered login server takes a Client ID Metadata Document. */
  cimd: boolean;
  /** The discovered login server offers no registration endpoint. */
  noRegistration: boolean;
  /** Client ids the discovered login server has forgotten: refused at authorize with 400, at token with invalid_client. */
  forgotten: Set<string>;
  /** The discovered login server refuses every client at authorize (a redirect-host allowlist). */
  rejectAuthorize: boolean;
  /** The authorize endpoint cannot be reached (the pre-flight is inconclusive). */
  authorizeUnreachable: boolean;
  /** Registrations answer HTTP 500. */
  failRegistrations: boolean;
  /** The protected resource's document names another resource. */
  foreignResource: boolean;
  /** The account the userinfo endpoint answers; undefined answers 404. */
  account: Record<string, unknown> | undefined;
}

export interface SignInRig {
  readonly store: SqliteStore;
  readonly vaults: VaultService;
  readonly secretService: SecretService;
  readonly levers: Levers;
  /** Every request that left the server, in order. */
  readonly requests: OutboundRequest[];
  /** The deps every sign-in door takes; `overrides` replace fields. */
  deps(overrides?: Partial<ConnectLinkDeps>): ConnectLinkDeps;
  /** Requests to one URL path prefix. */
  requestsTo(prefix: string): OutboundRequest[];
  close(): void;
}

let registrations = 0;

export function openSignInRig(): SignInRig {
  const dir = mkdtempSync(path.join(tmpdir(), "vault-sign-in-"));
  const store = SqliteStore.open(path.join(dir, "test.db"));
  const secretService = SecretService.create(undefined);
  const vaults = newVaultService({ store, logger: silentLogger, secretService, authorizationLifecycle: undefined });
  const levers: Levers = {
    denyVaultEdit: false,
    denyVaultEditFor: undefined,
    denyMyVault: false,
    tokenBodies: [],
    duringExchange: undefined,
    cimd: false,
    noRegistration: false,
    forgotten: new Set(),
    rejectAuthorize: false,
    authorizeUnreachable: false,
    failRegistrations: false,
    foreignResource: false,
    account: undefined,
  };
  const requests: OutboundRequest[] = [];

  const authorizer: Authorizer = {
    authorize(caller: CallerIdentity, check: AuthzCheck) {
      if (
        check.resourceKind === ApiResourceKind.vault &&
        check.permission === IamPermission.can_edit &&
        (levers.denyVaultEdit || levers.denyVaultEditFor === caller.identityId)
      ) {
        return Promise.resolve({ kind: "deny", reason: "" });
      }
      if (
        levers.denyMyVault &&
        check.resourceKind === ApiResourceKind.organization &&
        check.permission === IamPermission.can_create_vault
      ) {
        return Promise.resolve({ kind: "deny", reason: "" });
      }
      return Promise.resolve({ kind: "allow" });
    },
  };

  const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  async function outboundFetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const url = String(input);
    const body = typeof init?.body === "string" ? init.body : "";
    requests.push({ url, method: init?.method ?? "GET", body, headers: new Headers(init?.headers) });
    const parsed = new URL(url);
    const form = new URLSearchParams(body);
    if (url === VENDOR_TOKEN_URL || url === `${LOGIN_SERVER}/token`) {
      await levers.duringExchange?.();
      if (url === `${LOGIN_SERVER}/token` && levers.forgotten.has(form.get("client_id") ?? "")) {
        return json(401, { error: "invalid_client" });
      }
      const next = levers.tokenBodies.shift();
      return json(
        next?.status ?? 200,
        next?.body ?? { access_token: "at-default", token_type: "bearer", expires_in: 3600, refresh_token: "rt-default" },
      );
    }
    if (parsed.origin === MCP_ORIGIN && parsed.pathname.startsWith(PROTECTED_RESOURCE_PATH)) {
      // Every tool on this origin is protected by the one login server; a
      // document names the resource its URL was built for.
      const suffix = parsed.pathname.slice(PROTECTED_RESOURCE_PATH.length);
      return json(200, {
        resource: levers.foreignResource ? "https://mcp.victim.example/mcp" : `${MCP_ORIGIN}${suffix}`,
        authorization_servers: [levers.foreignResource ? "https://login.victim.example" : LOGIN_SERVER],
        scopes_supported: ["issues:read"],
      });
    }
    if (url === `${LOGIN_SERVER}/.well-known/oauth-authorization-server` || url === "https://login.victim.example/.well-known/oauth-authorization-server") {
      const base = parsed.origin === LOGIN_SERVER ? LOGIN_SERVER : "https://login.victim.example";
      return json(200, {
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        ...(levers.noRegistration ? {} : { registration_endpoint: `${base}/register` }),
        scopes_supported: ["read"],
        code_challenge_methods_supported: ["S256"],
        ...(levers.cimd ? { client_id_metadata_document_supported: true } : {}),
      });
    }
    if (url === `${LOGIN_SERVER}/register`) {
      if (levers.failRegistrations) {
        return json(500, { error: "server_error" });
      }
      registrations += 1;
      return json(201, { client_id: `dcr-client-${registrations}` });
    }
    if (parsed.origin + parsed.pathname === `${LOGIN_SERVER}/authorize`) {
      if (levers.authorizeUnreachable) {
        throw new Error("connect ECONNRESET");
      }
      return levers.rejectAuthorize || levers.forgotten.has(parsed.searchParams.get("client_id") ?? "")
        ? json(400, { error: "invalid_client", error_description: "unknown client" })
        : new Response("login page", { status: 200 });
    }
    if (url === "https://login.vendor.example/userinfo") {
      return levers.account === undefined ? json(404, {}) : json(200, levers.account);
    }
    return json(404, { error: "not found" });
  }

  return {
    store,
    vaults,
    secretService,
    levers,
    requests,
    deps(overrides) {
      return {
        store,
        logger: silentLogger,
        secretService,
        authorizer,
        vaults,
        pendingOAuthStates: store.pendingOAuthStates,
        clientRegistrations: store.oauthClientRegistrations,
        connectLinks: store.connectLinks,
        loginProviders: new Map<string, LoginProviderCredentials>(),
        oauthRedirectUri: REDIRECT_URI,
        clientDocumentUrl: "",
        outboundFetch,
        ...overrides,
      };
    },
    requestsTo(prefix) {
      return requests.filter((request) => request.url.startsWith(prefix));
    },
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Saves an organization's login app for `addresses` with its address
 * claims, as the OAuthApp create chain would.
 */
export async function seedOrganizationApp(
  rig: SignInRig,
  init: {
    readonly id?: string;
    readonly org?: string;
    readonly addresses?: readonly string[];
    readonly clientId?: string;
    readonly tokenUrl?: string;
    readonly approval?: VendorApprovalStatus;
    readonly userinfoUrl?: string;
    readonly authorizationUrl?: string;
  } = {},
): Promise<string> {
  const id = init.id ?? "oap_vendor";
  const org = init.org ?? ORG;
  const addresses = init.addresses ?? [VENDOR_ADDRESS];
  const app = create(OAuthAppSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "OAuthApp",
    metadata: { id, name: id, slug: id, org },
    spec: {
      provider: "Vendor",
      clientId: init.clientId ?? "vendor-client",
      clientSecret: "vendor-secret",
      authorizationUrl: init.authorizationUrl ?? "https://login.vendor.example/authorize",
      tokenUrl: init.tokenUrl ?? VENDOR_TOKEN_URL,
      scopes: ["read"],
      userinfoUrl: init.userinfoUrl ?? "",
      vendorApprovalStatus: init.approval ?? VendorApprovalStatus.APPROVED,
      tokenEndpointAuthMethod: TokenEndpointAuthMethod.UNSPECIFIED,
      addresses: [...addresses],
    },
  });
  await rig.store.saveResource(ApiResourceKind.oauth_app, id, OAuthAppSchema, app);
  for (const address of addresses) {
    await rig.store.resourceNames.claim(oauthAppAddressKey(org, address), id, new Date().toISOString());
  }
  return id;
}

/** Saves a shared vault of the organization. */
export async function seedSharedVault(rig: SignInRig, id = "vlt_shared", org = ORG): Promise<string> {
  const vault = create(VaultSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: { id, name: "Support tools", slug: `support-tools-${id}`, org },
    spec: { owner: { case: "org", value: org } },
  });
  await rig.store.saveResource(ApiResourceKind.vault, id, VaultSchema, vault);
  return id;
}

/** The login a person's My vault holds at an address, opened. */
export async function myLogin(rig: SignInRig, caller: CallerIdentity, address: string): Promise<string | undefined> {
  const mine = await rig.vaults.findMine(ORG, caller.identityId);
  if (mine === undefined) {
    return undefined;
  }
  return (await rig.vaults.open(mine)).connections.get(address)?.token;
}

/** The login a vault holds at an address, opened. */
export async function vaultLogin(rig: SignInRig, vaultId: string, address: string): Promise<string | undefined> {
  const vault = await rig.vaults.findById(vaultId);
  return vault === undefined ? undefined : (await rig.vaults.open(vault)).connections.get(address)?.token;
}

export async function expectRefusal(promise: Promise<unknown>, code: Code, fragment: string): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ConnectError);
  expect((error as ConnectError).code).toBe(code);
  expect((error as ConnectError).rawMessage).toContain(fragment);
  return error as ConnectError;
}
