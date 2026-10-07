/**
 * Pins the sign-in module (oauth/sign-in.ts): the refresh that keeps a
 * sign-in's access token fresh before a run reads it, the admin gate on an
 * organization's sign-in, and how a refresh token is sealed on its grant.
 *
 * The refresh runs over a real store and the REAL credential pipeline (the
 * credential services on an in-process router, as the composition root
 * wires the sign-in client), so the renewed token is written the way
 * production writes it: sealed, through setFields, as the server. The
 * vendor's token endpoint is the injected outbound fetch, answering per
 * test and recording every request.
 *
 * What it pins:
 *   - an expired sign-in with a sealed refresh token is renewed: the new
 *     access token lands sealed in the sign-in's credential, the grant
 *     takes the new expiry and the new refresh token (sealed), and a run's
 *     resolution reads the fresh value;
 *   - the organization's sign-in (grant identity "") is renewed the same way;
 *   - a vendor sign-in presents its OAuth app's client secret, decrypted,
 *     the way the app's auth method says; an app that is gone is logged,
 *     and an app or a server that is gone leaves the refresh to go on as a
 *     public client;
 *   - an expired sign-in with no refresh token, and a refresh the vendor
 *     refuses, refuse FailedPrecondition and leave the old token in place:
 *     a run must stop at create, not fail halfway with a 401;
 *   - a sign-in still inside its expiry, a grant that names another
 *     credential, a target that is not an MCP server and a server that is
 *     gone are left alone, with no call to the vendor;
 *   - store faults: a grant that cannot be read or a refresh token that
 *     cannot be unsealed is Internal; a token that cannot be saved is
 *     Internal; a grant update that fails after the token was saved is
 *     logged, not fatal; a re-read that fails answers the credential given.
 */
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, createClient, createRouterTransport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { OutboundFetch } from "@stigmer/outbound/egress";
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
import { CredentialSource } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/status_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSignIn } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { TokenEndpointAuthMethod } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/spec_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { createLogger } from "../../../../boot/logger.js";
import type { LogFields } from "../../../../boot/logger.js";
import {
  EncryptionScope,
  SecretService,
  isCiphertextShaped,
} from "../../../../encryption/encryption.js";
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../../../../extensions/authorizer.js";
import {
  errorOf,
  testCallerIdentity,
} from "../../../../pipeline/__tests__/support.js";
import { createApiResourceInterceptor } from "../../../../pipeline/interceptors/apiresource.js";
import { createInProcessCallerInterceptor } from "../../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import type {
  OAuthGrant,
  OAuthGrantStore,
  Store,
} from "../../../../store/interface.js";
import { SqliteStore } from "../../../../store/sqlite/store.js";
import { registerCredentialServices } from "../../../credential/controller.js";
import { credentialListIndex } from "../../../credential/list-index.js";
import { resolveCredentials } from "../../../credential/resolve.js";
import type { SignInCredentialClient } from "../../../credential/sign-in.js";
import { SignInCredentials } from "../../../credential/sign-in.js";
import { CredentialValues } from "../../../credential/values.js";
import {
  SignInRefresher,
  requireOrganizationSignInAdmin,
  sealRefreshToken,
  unsealRefreshToken,
} from "../sign-in.js";

const ORG = "acme";
const ANA = "acc_ana";
const FIELD = "SRV_TOKEN";
const TOKEN_URL = "https://auth.example.test/token";

const secrets = SecretService.create(randomBytes(32));

interface LoggedLine {
  readonly level: string;
  readonly message: string;
  readonly fields: LogFields | undefined;
}

/** A logger that keeps what it was told, so a test can read the WARN a non-fatal path writes. */
function recordingLogger(): {
  logger: ReturnType<typeof createLogger>;
  lines: LoggedLine[];
} {
  const lines: LoggedLine[] = [];
  const logger = createLogger({
    level: "debug",
    pretty: false,
    write: () => {},
    sink: ({ level, message, fields }) => {
      lines.push({ level, message, fields });
    },
  });
  return { logger, lines };
}

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

let dir: string;
let store: Store;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sign-in-refresh-"));
  store = SqliteStore.open(path.join(dir, "stigmer.db"), undefined, {
    listIndexes: [credentialListIndex],
  });
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/**
 * The credential domain's in-process client, as the composition root wires
 * it: the registered handlers behind the in-process caller interceptor, so
 * a write with no propagated caller runs as the server.
 */
function credentialClient(): SignInCredentialClient {
  const transport = createRouterTransport(
    (router) => {
      registerCredentialServices(router, {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        authorizationLifecycle: undefined,
        secretService: secrets,
        listReadScope: undefined,
      });
    },
    {
      router: {
        interceptors: [
          createInProcessCallerInterceptor(),
          createApiResourceInterceptor(),
        ],
      },
    },
  );
  const client = createClient(CredentialCommandController, transport);
  return {
    create: (credential) => client.create(credential),
    setFields: (input) => client.setFields(input),
    removeFields: (input) => client.removeFields(input),
    delete: (input) => client.delete(input),
  };
}

/** The vendor's token endpoint: answers `respond()` and records every request's form. */
function tokenEndpoint(respond: () => Response = () => grantResponse({})): {
  readonly fetch: OutboundFetch;
  readonly forms: URLSearchParams[];
  readonly authorizations: string[];
} {
  const forms: URLSearchParams[] = [];
  const authorizations: string[] = [];
  return {
    forms,
    authorizations,
    fetch: async (_url, init) => {
      forms.push(new URLSearchParams(String(init?.body ?? "")));
      const headers = (init?.headers ?? {}) as Record<string, string>;
      authorizations.push(headers["Authorization"] ?? "");
      return respond();
    },
  };
}

function grantResponse(body: {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}): Response {
  return new Response(
    JSON.stringify({
      access_token: body.access_token ?? "at-new",
      token_type: "bearer",
      ...(body.refresh_token === undefined
        ? {}
        : { refresh_token: body.refresh_token }),
      ...(body.expires_in === undefined ? {} : { expires_in: body.expires_in }),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const now = (): number => Math.floor(Date.now() / 1000);

interface SeededSignIn {
  readonly server: McpServer;
  readonly credential: Credential;
  readonly grant: OAuthGrant;
}

let counter = 0;

/**
 * A server, its sign-in credential holding "at-old" sealed, and the grant
 * naming the credential, with the refresh token sealed as the connect lane
 * seals it ("" for none).
 */
async function seedSignIn(init: {
  readonly expiresAt: number;
  readonly refreshToken?: string;
  readonly organization?: boolean;
  readonly vendorApp?: string;
  readonly grantCredentialId?: string;
}): Promise<SeededSignIn> {
  counter += 1;
  const slug = `srv-${counter}`;
  const server = create(McpServerSchema, {
    metadata: {
      id: `mcps_${counter}`,
      org: ORG,
      slug,
      name: `Server ${counter}`,
    },
    spec: {
      signIn:
        init.organization === true
          ? McpServerSignIn.organization
          : McpServerSignIn.unspecified,
      auth: {
        targetEnvVar: FIELD,
        ...(init.vendorApp === undefined
          ? {}
          : {
              oauthAppRef: {
                kind: ApiResourceKind.oauth_app,
                org: ORG,
                slug: init.vendorApp,
              },
            }),
      },
    },
  });
  await store.saveResource(
    ApiResourceKind.mcp_server,
    `mcps_${counter}`,
    McpServerSchema,
    server,
  );
  const credentialId = `cred_${counter}`;
  const credential = create(CredentialSchema, {
    metadata: { id: credentialId, org: ORG, slug: `cred-${counter}` },
    spec: {
      owner:
        init.organization === true
          ? { case: "org", value: ORG }
          : { case: "person", value: ANA },
      fields: {
        [FIELD]: {
          value: await secrets.encrypt(
            "at-old",
            EncryptionScope.forOrganization(ORG),
          ),
        },
      },
      serves: [
        {
          target: {
            case: "mcpServer",
            value: { kind: ApiResourceKind.mcp_server, org: ORG, slug },
          },
        },
      ],
    },
    status: { source: CredentialSource.oauth },
  });
  await store.saveResource(
    ApiResourceKind.credential,
    credentialId,
    CredentialSchema,
    credential,
  );
  const grant: OAuthGrant = {
    identityAccountId: init.organization === true ? "" : ANA,
    resourceId: `mcps_${counter}`,
    resourceKind: "mcp_server",
    orgId: ORG,
    accessTokenExpiresAt: init.expiresAt,
    clientId: "client-1",
    authMethod: init.vendorApp === undefined ? "mcp_oauth" : "vendor_oauth",
    tokenEndpoint: TOKEN_URL,
    accessTokenEnvVar: FIELD,
    credentialId: init.grantCredentialId ?? credentialId,
    refreshToken: await sealRefreshToken(
      secrets,
      silentLogger,
      init.refreshToken ?? "",
      ORG,
    ),
    createdAt: 0,
    updatedAt: 0,
  };
  await store.oauthGrants.upsert(grant);
  return { server, credential, grant };
}

function refresher(
  fetch: OutboundFetch,
  options: { store?: Store; logger?: ReturnType<typeof createLogger> } = {},
): SignInRefresher {
  const logger = options.logger ?? silentLogger;
  return new SignInRefresher({
    store: options.store ?? store,
    logger,
    secretService: secrets,
    signIns: new SignInCredentials(credentialClient(), store, logger),
    outboundFetch: fetch,
  });
}

const values = new CredentialValues(secrets, silentLogger);

async function tokenOf(credential: Credential): Promise<string | undefined> {
  return values.fieldValue(credential, FIELD);
}

async function storedCredential(id: string): Promise<Credential> {
  return store.getResource(ApiResourceKind.credential, id, CredentialSchema);
}

async function storedGrant(
  seeded: SeededSignIn,
): Promise<OAuthGrant | undefined> {
  return store.oauthGrants.find(
    seeded.grant.identityAccountId,
    seeded.grant.resourceId,
    ORG,
  );
}

/** The store, with the reads or grant writes a fault test names replaced. */
function storeWith(overrides: {
  readonly getResource?: Store["getResource"];
  readonly oauthGrants?: Partial<OAuthGrantStore>;
}): Store {
  return new Proxy(store, {
    get(target, prop) {
      if (prop === "getResource" && overrides.getResource !== undefined) {
        return overrides.getResource;
      }
      if (prop === "oauthGrants" && overrides.oauthGrants !== undefined) {
        const grants = target.oauthGrants;
        return {
          upsert: (grant: OAuthGrant) => grants.upsert(grant),
          find: (identity: string, resourceId: string, org: string) =>
            grants.find(identity, resourceId, org),
          ...overrides.oauthGrants,
        };
      }
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("SignInRefresher — an expired sign-in is renewed", () => {
  it("writes the new access token into the credential and the new expiry and refresh token onto the grant", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt-old",
    });
    const vendor = tokenEndpoint(() =>
      grantResponse({
        access_token: "at-new",
        refresh_token: "rt-new",
        expires_in: 3600,
      }),
    );

    const fresh = await refresher(vendor.fetch).freshen(seeded.credential);

    expect(vendor.forms).toHaveLength(1);
    expect(vendor.forms[0]?.get("grant_type")).toBe("refresh_token");
    expect(vendor.forms[0]?.get("refresh_token")).toBe("rt-old");
    expect(vendor.forms[0]?.get("client_id")).toBe("client-1");
    // The answer is the credential re-read after the write, holding the new token.
    expect(await tokenOf(fresh)).toBe("at-new");
    const stored = await storedCredential(seeded.credential.metadata?.id ?? "");
    const rested = stored.spec?.fields[FIELD]?.value ?? "";
    expect(isCiphertextShaped(rested)).toBe(true);
    expect(await secrets.decrypt(rested)).toBe("at-new");
    const grant = await storedGrant(seeded);
    expect(grant?.credentialId).toBe(seeded.credential.metadata?.id);
    expect(grant?.accessTokenExpiresAt).toBeGreaterThanOrEqual(now() + 3590);
    expect(grant?.accessTokenExpiresAt).toBeLessThanOrEqual(now() + 3600);
    expect(isCiphertextShaped(grant?.refreshToken ?? "")).toBe(true);
    expect(await unsealRefreshToken(secrets, grant?.refreshToken ?? "")).toBe(
      "rt-new",
    );
  });

  it("a run's resolution reads the renewed value, never the expired one", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt-old",
    });
    const vendor = tokenEndpoint(() =>
      grantResponse({ access_token: "at-run", expires_in: 600 }),
    );

    const delivered = await resolveCredentials(
      {
        store,
        logger: silentLogger,
        authorizer: newPermissiveSingleTeamAuthorizer(),
        values,
        signIns: refresher(vendor.fetch),
      },
      {
        runId: "run_fresh",
        org: ORG,
        person: ANA,
        runtimeEnv: {},
        surface: undefined,
        requirements: [
          {
            declarer: {
              kind: "mcp_server",
              id: seeded.server.metadata?.id ?? "",
              org: ORG,
              slug: seeded.server.metadata?.slug ?? "",
              signIn: McpServerSignIn.unspecified,
            },
            key: FIELD,
            declaration: { isSecret: true, optional: false },
          },
        ],
      },
    );

    expect(delivered.get(FIELD)?.value).toBe("at-run");
    expect(vendor.forms).toHaveLength(1);
    // A vendor that does not rotate leaves the refresh token as it was.
    const grant = await storedGrant(seeded);
    expect(await unsealRefreshToken(secrets, grant?.refreshToken ?? "")).toBe(
      "rt-old",
    );
  });

  it("the organization's sign-in is found under the empty identity and renewed", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt-org",
      organization: true,
    });
    const vendor = tokenEndpoint(() =>
      grantResponse({ access_token: "at-org", expires_in: 60 }),
    );

    const fresh = await refresher(vendor.fetch).freshen(seeded.credential);

    expect(vendor.forms[0]?.get("refresh_token")).toBe("rt-org");
    expect(await tokenOf(fresh)).toBe("at-org");
    expect((await storedGrant(seeded))?.identityAccountId).toBe("");
  });
});

describe("SignInRefresher — a vendor sign-in presents its OAuth app's client secret", () => {
  it("loads the app's secret, decrypted, and presents it the way the app's auth method says", async () => {
    const appSlug = `vendor-app-${counter + 1}`;
    await store.saveResource(
      ApiResourceKind.oauth_app,
      `oap_${appSlug}`,
      OAuthAppSchema,
      create(OAuthAppSchema, {
        metadata: {
          id: `oap_${appSlug}`,
          org: ORG,
          slug: appSlug,
          name: appSlug,
        },
        spec: {
          provider: "exampleco",
          clientId: "client-1",
          clientSecret: await secrets.encrypt(
            "vendor-secret",
            EncryptionScope.forOrganization(ORG),
          ),
          tokenEndpointAuthMethod: TokenEndpointAuthMethod.CLIENT_SECRET_POST,
        },
      }),
    );
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt-vendor",
      vendorApp: appSlug,
    });
    const vendor = tokenEndpoint();

    await refresher(vendor.fetch).freshen(seeded.credential);

    expect(vendor.forms[0]?.get("client_secret")).toBe("vendor-secret");
    expect(vendor.authorizations[0]).toBe("");
  });

  it("an app that is gone is logged and the refresh goes on with no client secret", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt-vendor",
      vendorApp: "vendor-app-gone",
    });
    const vendor = tokenEndpoint(() =>
      grantResponse({ access_token: "at-public" }),
    );
    const { logger, lines } = recordingLogger();

    const fresh = await refresher(vendor.fetch, { logger }).freshen(
      seeded.credential,
    );

    expect(await tokenOf(fresh)).toBe("at-public");
    expect(vendor.forms[0]?.get("client_secret")).toBeNull();
    expect(vendor.authorizations[0]).toBe("");
    const warned = lines.find(
      (line) =>
        line.message ===
        "Failed to load the OAuth app's client secret for a refresh",
    );
    expect(warned?.level).toBe("warn");
    expect(warned?.fields?.error).toBe("OAuthApp 'vendor-app-gone' not found");
  });

  it("a vendor grant whose server is gone refreshes as a public client", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt-vendor",
      vendorApp: "vendor-app-unread",
    });
    const vendor = tokenEndpoint(() =>
      grantResponse({ access_token: "at-orphan" }),
    );

    const refreshed = await refresher(vendor.fetch).refresh({
      ...seeded.grant,
      resourceId: "mcps_deleted_since",
    });

    expect(refreshed).toBe(true);
    expect(vendor.forms[0]?.get("client_secret")).toBeNull();
    expect(
      await tokenOf(
        await storedCredential(seeded.credential.metadata?.id ?? ""),
      ),
    ).toBe("at-orphan");
  });
});

describe("SignInRefresher — a sign-in that cannot be renewed refuses", () => {
  it("an expired sign-in with no refresh token refuses FailedPrecondition and keeps its token", async () => {
    const seeded = await seedSignIn({ expiresAt: now() - 10 });
    const vendor = tokenEndpoint();

    const error = await errorOf(() =>
      refresher(vendor.fetch).freshen(seeded.credential),
    );

    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain(
      "has expired and no refresh token is available",
    );
    expect(vendor.forms).toHaveLength(0);
    expect(
      await tokenOf(
        await storedCredential(seeded.credential.metadata?.id ?? ""),
      ),
    ).toBe("at-old");
  });

  it("a refresh the vendor refuses is FailedPrecondition, and the grant is left as it was", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt-revoked",
    });
    const vendor = tokenEndpoint(
      () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );

    const error = await errorOf(() =>
      refresher(vendor.fetch).freshen(seeded.credential),
    );

    expect(error.code).toBe(Code.FailedPrecondition);
    expect(error.rawMessage).toContain("token refresh failed");
    expect(error.rawMessage).toContain("Please re-authenticate");
    expect((await storedGrant(seeded))?.accessTokenExpiresAt).toBe(
      seeded.grant.accessTokenExpiresAt,
    );
    expect(
      await tokenOf(
        await storedCredential(seeded.credential.metadata?.id ?? ""),
      ),
    ).toBe("at-old");
  });
});

describe("SignInRefresher — what it leaves alone", () => {
  it("a sign-in still inside its expiry is not refreshed", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() + 3600,
      refreshToken: "rt",
    });
    const vendor = tokenEndpoint();

    const answered = await refresher(vendor.fetch).freshen(seeded.credential);

    expect(answered).toBe(seeded.credential);
    expect(vendor.forms).toHaveLength(0);
  });

  it("a grant that names another credential is not this sign-in's", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt",
      grantCredentialId: "cred_someone_else",
    });
    const vendor = tokenEndpoint();

    const answered = await refresher(vendor.fetch).freshen(seeded.credential);

    expect(answered).toBe(seeded.credential);
    expect(vendor.forms).toHaveLength(0);
  });

  it("a git host target and a server that is gone are skipped", async () => {
    const credential = create(CredentialSchema, {
      metadata: { id: "cred_skips", org: ORG, slug: "cred-skips" },
      spec: {
        owner: { case: "person", value: ANA },
        serves: [
          { target: { case: "gitHost", value: "github.com" } },
          {
            target: {
              case: "mcpServer",
              value: {
                kind: ApiResourceKind.mcp_server,
                org: ORG,
                slug: "never-saved",
              },
            },
          },
        ],
      },
      status: { source: CredentialSource.oauth },
    });
    const vendor = tokenEndpoint();

    const answered = await refresher(vendor.fetch).freshen(credential);

    expect(answered).toBe(credential);
    expect(vendor.forms).toHaveLength(0);
  });
});

describe("SignInRefresher — store faults", () => {
  it("a grant that cannot be read is Internal", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt",
    });
    const faulty = storeWith({
      oauthGrants: { find: () => Promise.reject(new Error("SQLITE_BUSY")) },
    });

    const error = await errorOf(() =>
      refresher(tokenEndpoint().fetch, { store: faulty }).freshen(
        seeded.credential,
      ),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to read the sign-in's grant");
  });

  it("a refresh token that cannot be unsealed is Internal, and the vendor is never called", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt",
    });
    const sealed = seeded.grant.refreshToken;
    await store.oauthGrants.upsert({
      ...seeded.grant,
      refreshToken: `${sealed.slice(0, -6)}AAAAAA`,
    });
    const vendor = tokenEndpoint();

    const error = await errorOf(() =>
      refresher(vendor.fetch).freshen(seeded.credential),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "failed to unseal the sign-in's refresh token",
    );
    expect(vendor.forms).toHaveLength(0);
  });

  it("a token that cannot be saved (its credential is gone) is Internal", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt",
    });
    await store.deleteResource(
      ApiResourceKind.credential,
      seeded.credential.metadata?.id ?? "",
    );

    const error = await errorOf(() =>
      refresher(tokenEndpoint().fetch).refresh(seeded.grant),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe("failed to save the refreshed access token");
  });

  it("a grant update that fails after the token was saved is logged, and the fresh token is still read", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt",
    });
    const faulty = storeWith({
      oauthGrants: { upsert: () => Promise.reject(new Error("SQLITE_BUSY")) },
    });
    const { logger, lines } = recordingLogger();

    const fresh = await refresher(
      tokenEndpoint(() => grantResponse({ access_token: "at-kept" })).fetch,
      {
        store: faulty,
        logger,
      },
    ).freshen(seeded.credential);

    expect(await tokenOf(fresh)).toBe("at-kept");
    expect(
      lines.some(
        (line) =>
          line.level === "warn" &&
          line.message ===
            "Failed to update the OAuth grant after a refresh (non-fatal)",
      ),
    ).toBe(true);
    expect((await storedGrant(seeded))?.accessTokenExpiresAt).toBe(
      seeded.grant.accessTokenExpiresAt,
    );
  });

  it("a re-read that fails after the refresh answers the credential it was given", async () => {
    const seeded = await seedSignIn({
      expiresAt: now() - 10,
      refreshToken: "rt",
    });
    const getResource: Store["getResource"] = (kind, id, schema) =>
      kind === ApiResourceKind.credential
        ? Promise.reject(new Error("SQLITE_BUSY"))
        : store.getResource(kind, id, schema);
    const faulty = storeWith({ getResource });

    const answered = await refresher(tokenEndpoint().fetch, {
      store: faulty,
    }).freshen(seeded.credential);

    expect(answered).toBe(seeded.credential);
    // The write itself landed: the next read gets the renewed token.
    expect(
      await tokenOf(
        await storedCredential(seeded.credential.metadata?.id ?? ""),
      ),
    ).toBe("at-new");
  });
});

describe("requireOrganizationSignInAdmin", () => {
  const orgServer = create(McpServerSchema, {
    metadata: { id: "mcps_org", org: ORG, slug: "shared-server" },
    spec: { signIn: McpServerSignIn.organization },
  });

  function answering(decide: () => Promise<AuthzDecision>): {
    authorizer: Authorizer;
    asked: AuthzCheck[];
  } {
    const asked: AuthzCheck[] = [];
    return {
      asked,
      authorizer: {
        authorize: (_caller, check) => {
          asked.push(check);
          return decide();
        },
      },
    };
  }

  it("a personal sign-in is every member's own: nothing is asked", async () => {
    const { authorizer, asked } = answering(() =>
      Promise.resolve({ kind: "deny", reason: "" }),
    );
    const personal = create(McpServerSchema, {
      metadata: { slug: "mine" },
      spec: {},
    });

    await requireOrganizationSignInAdmin(
      authorizer,
      testCallerIdentity(),
      personal,
      ORG,
    );

    expect(asked).toHaveLength(0);
  });

  it("asks can_create_org_credential on the organization and admits an admin", async () => {
    const { authorizer, asked } = answering(() =>
      Promise.resolve({ kind: "allow" }),
    );

    await requireOrganizationSignInAdmin(
      authorizer,
      testCallerIdentity(),
      orgServer,
      ORG,
    );

    expect(asked).toEqual([
      {
        permission: IamPermission.can_create_org_credential,
        resourceKind: ApiResourceKind.organization,
        resourceId: ORG,
      },
    ]);
  });

  it.each([
    [
      "deny",
      (): Promise<AuthzDecision> =>
        Promise.resolve({ kind: "deny", reason: "no" }),
    ],
    [
      "not-found",
      (): Promise<AuthzDecision> => Promise.resolve({ kind: "not-found" }),
    ],
  ])(
    "a %s answer refuses PermissionDenied naming the server",
    async (_kind, decide) => {
      const { authorizer } = answering(decide);

      const error = await errorOf(() =>
        requireOrganizationSignInAdmin(
          authorizer,
          testCallerIdentity(),
          orgServer,
          ORG,
        ),
      );

      expect(error.code).toBe(Code.PermissionDenied);
      expect(error.rawMessage).toBe(
        "MCP server 'shared-server' uses the organization's sign-in; only the organization's admins sign it in or out",
      );
    },
  );

  it("an authorizer that fails is Internal, never a denial", async () => {
    const { authorizer } = answering(() =>
      Promise.reject(new Error("fga down")),
    );

    const error = await errorOf(() =>
      requireOrganizationSignInAdmin(
        authorizer,
        testCallerIdentity(),
        orgServer,
        ORG,
      ),
    );

    expect(error.code).toBe(Code.Internal);
    expect(error.rawMessage).toBe(
      "failed to authorize the organization's sign-in",
    );
  });
});

describe("sealing a refresh token on its grant", () => {
  it("seals with the organization's scope, and unseals back", async () => {
    const sealed = await sealRefreshToken(
      secrets,
      silentLogger,
      "rt-seal",
      ORG,
    );

    expect(isCiphertextShaped(sealed)).toBe(true);
    expect(await unsealRefreshToken(secrets, sealed)).toBe("rt-seal");
  });

  it("no refresh token stays empty either way", async () => {
    expect(await sealRefreshToken(secrets, silentLogger, "", ORG)).toBe("");
    expect(await unsealRefreshToken(secrets, "")).toBe("");
  });

  it("keyless, the token rests plaintext with a WARN, and a plaintext row unseals to itself", async () => {
    const keyless = SecretService.create(undefined);
    const { logger, lines } = recordingLogger();

    const sealed = await sealRefreshToken(keyless, logger, "rt-plain", ORG);

    expect(sealed).toBe("rt-plain");
    expect(lines).toEqual([
      {
        level: "warn",
        message:
          "Encryption disabled: an OAuth refresh token will be stored in plaintext",
        fields: undefined,
      },
    ]);
    expect(await unsealRefreshToken(keyless, sealed)).toBe("rt-plain");
  });
});
