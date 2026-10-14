/**
 * Every URL an organization admin writes into a federation issuer is
 * dialed through the ONE fetch the host hands the enterprise-identity unit
 * (`EnterpriseIdentityPorts.outboundFetch`, the egress-guarded fetch in any
 * host that serves tenants). The type cannot say it: the global `fetch` is
 * assignable to `OutboundFetch`, so a dial that reached for it, or a second
 * fetch threaded to one lane, would compile and quietly reopen the
 * request-forgery path the guard closes. This suite proves the threading by
 * behaviour, over the unit built the way any host builds it: the ports get
 * a recording fetch, the global `fetch` is stubbed to throw, and each of
 * the unit's dials is driven through its own door:
 *
 *   - a FederationIssuer create reads the issuer's discovery document and
 *     checks the JWKS it names (the save-time validation);
 *   - a token naming the provider has its signing keys fetched (the
 *     federated lane's key cache);
 *   - a first sign-in whose token carries no email reads the profile from
 *     the provider's userinfo endpoint (JIT provisioning).
 *
 * Every dial lands in the recorder and none reaches the global stub. That
 * the host hands the unit a GUARDED fetch is the host's own fact, pinned
 * where the host builds it, in the host's own suites.
 */
import { createSign, generateKeyPairSync } from "node:crypto";

import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  Code,
  ConnectError,
  createClient,
  createRouterTransport,
  type Interceptor,
} from "@connectrpc/connect";
import type { OutboundFetch } from "@stigmer/outbound/egress";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApiResourceAuditInfoSchema,
  ApiResourceAuditSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { FederationIssuerSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/api_pb";
import { FederationIssuerCommandController } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/command_pb";
import { FederationIssuerSpecSchema } from "@stigmer/protos/ai/stigmer/iam/federationissuer/v1/spec_pb";
import {
  OrganizationSchema,
  OrganizationStatusSchema,
} from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/query_pb";
import {
  callerIdentityKey,
  type AuthorizationQueryEngine,
  type Authorizer,
  type ChildOrganizations,
  type ComposedGrants,
  type ComposedIdentityAccounts,
  type ListReadScope,
  type ResourceAuthorizationLifecycle,
  type ServerExtension,
} from "@stigmer/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refusingPort, SILENT_LOGGER } from "../../__test-utils__/refusing-doubles.js";
import type { IdentityAccountService } from "../../iam/account/port.js";
import { InMemoryIssuerStore, storedIssuer } from "../../iam/issuer/__tests__/in-memory-issuer-store.js";
import { inMemorySignInGrants } from "../../iam/federation/__tests__/in-memory-sign-in-grants.js";
import { UNBOUND_CREDENTIAL_BINDING } from "../../__test-utils__/unbound-credential-binding.js";
import { newEnterpriseIdentityExtension } from "../enterprise-identity.js";
import { inMemoryNames } from "../../__test-utils__/in-memory-names.js";

const ISSUER = "https://idp.acme.test";
const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
const JWKS = `${ISSUER}/.well-known/jwks.json`;
const USERINFO = `${ISSUER}/userinfo`;
const AUDIENCE = "https://api.acme.test/stigmer";

const SIGNING = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEYS = JSON.stringify({
  keys: [{ ...SIGNING.publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" }],
});

/** What the provider's issuer publishes, by URL; anything else fails like an unreachable host. */
const PUBLISHED: Record<string, () => Response> = {
  [DISCOVERY]: () =>
    new Response(
      JSON.stringify({
        issuer: `${ISSUER}/`,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/oauth/token`,
        userinfo_endpoint: USERINFO,
        jwks_uri: JWKS,
      }),
    ),
  [JWKS]: () => new Response(KEYS),
  [USERINFO]: () => new Response(JSON.stringify({ email: "dana@acme.test", given_name: "Dana" })),
};

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/** An RS256 token from the provider's issuer, with no email claim, so a first sign-in reads userinfo. */
function signedToken(): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "k1" }));
  const payload = base64url(
    JSON.stringify({
      iss: `${ISSUER}/`,
      aud: AUDIENCE,
      sub: "idp|dana",
      exp: Math.floor(Date.now() / 1000) + 600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${base64url(signer.sign(SIGNING.privateKey))}`;
}

/** `acme`, the one organization the in-process service knows, older than any provider here. */
const organizations = createRouterTransport(({ service }) => {
  service(OrganizationQueryController, {
    get: (request) => {
      if (request.value !== "acme") {
        throw new ConnectError("organization not found", Code.NotFound);
      }
      const stamp = timestampFromDate(new Date("2026-09-01T00:00:00Z"));
      return create(OrganizationSchema, {
        metadata: create(ApiResourceMetadataSchema, { id: "acme", slug: "acme", name: "Acme" }),
        status: create(OrganizationStatusSchema, {
          audit: create(ApiResourceAuditSchema, {
            specAudit: create(ApiResourceAuditInfoSchema, { createdAt: stamp, updatedAt: stamp }),
          }),
        }),
      });
    },
  });
});

const ALLOW: Authorizer = { authorize: () => Promise.resolve({ kind: "allow" }) };

/** The create's creation event is accepted; the suite deletes nothing and changes no visibility. */
const LIFECYCLE: ResourceAuthorizationLifecycle = {
  onResourceCreated: () => Promise.resolve(),
  onResourceDeleted: () => Promise.reject(new Error("the suite deletes nothing")),
  onVisibilityChanged: () => Promise.reject(new Error("the suite changes no visibility")),
};

/** An account service with no federated account yet, which records the one JIT creates. */
function accountService(created: IdentityAccount[]): IdentityAccountService {
  return {
    createAccount: (request) => {
      const account = create(IdentityAccountSchema, {
        metadata: create(ApiResourceMetadataSchema, { id: "ida_dana", org: request.org }),
        spec: request.spec,
      });
      created.push(account);
      return Promise.resolve(account);
    },
    updateAccount: () => Promise.reject(new Error("the sign-in updates no account")),
    deleteAccount: () => Promise.reject(new Error("the sign-in deletes no account")),
    store: new Proxy(refusingPort<IdentityAccountService["store"]>("accounts.store"), {
      get: (target, member) =>
        // No federated row yet, and the admin is no service account.
        member === "findByIssuerAndIdpId" || member === "findById"
          ? () => Promise.resolve(undefined)
          : Reflect.get(target, member),
    }),
  };
}

interface Rig {
  readonly unit: ServerExtension;
  readonly store: InMemoryIssuerStore;
  readonly dialed: string[];
  readonly created: IdentityAccount[];
}

function rig(store: InMemoryIssuerStore = new InMemoryIssuerStore()): Rig {
  const dialed: string[] = [];
  const recording: OutboundFetch = (url) => {
    const key = String(url);
    dialed.push(key);
    const answer = PUBLISHED[key];
    return answer === undefined ? Promise.reject(new TypeError("fetch failed")) : Promise.resolve(answer());
  };
  const created: IdentityAccount[] = [];
  const unit = newEnterpriseIdentityExtension({
    providers: store,
    teams: refusingPort("teams"),
    invitations: refusingPort("invitations"),
    signInGrants: inMemorySignInGrants(),
    accounts: accountService(created),
    schema: { ensure: () => Promise.resolve() },
    outboundFetch: recording,
    reservedIssuers: [],
    logger: SILENT_LOGGER,
  });
  unit.onComposed?.({
    authorizer: ALLOW,
    credentialBinding: UNBOUND_CREDENTIAL_BINDING,
    listReadScope: refusingPort<ListReadScope>("listReadScope"),
    authorizationQueries: refusingPort<Pick<AuthorizationQueryEngine, "check">>("authorizationQueries"),
    resourceAuthorizationLifecycle: LIFECYCLE,
    childOrganizations: refusingPort<ChildOrganizations>("childOrganizations"),
    identityAccounts: refusingPort<ComposedIdentityAccounts>("identityAccounts"),
    grants: refusingPort<ComposedGrants>("grants"),
    inProcessTransport: organizations,
    resourceNames: inMemoryNames().resourceNames,
  });
  return { unit, store, dialed, created };
}

const asAdmin: Interceptor = (next) => (request) => {
  request.contextValues.set(callerIdentityKey, {
    identityId: "ida_admin",
    callerClass: "user",
    issuer: "https://issuer.invalid",
    rawToken: "tok",
  });
  return next(request);
};

/** The stored JIT provider the sign-in cases route to: the issuer's own JWKS and userinfo. */
function jitIssuer() {
  const provider = storedIssuer({
    id: "fis_acme",
    org: "acme",
    slug: "acme-idp",
    issuers: [`${ISSUER}/`],
    expectedAudience: AUDIENCE,
  });
  const spec = provider.spec ?? create(FederationIssuerSpecSchema);
  spec.jwksUri = JWKS;
  spec.userinfoEndpoint = USERINFO;
  spec.createAccountsOnSignIn = true;
  provider.spec = spec;
  return provider;
}

describe("the enterprise-identity unit dials every tenant-written URL through its one fetch", () => {
  const globalFetch = vi.fn(() => Promise.reject(new Error("a dial reached the global fetch")));

  beforeEach(() => {
    vi.stubGlobal("fetch", globalFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalFetch.mockClear();
  });

  it("a FederationIssuer create reads the issuer's discovery document and its JWKS through it", async () => {
    const r = rig();
    const transport = createRouterTransport(
      (inner) => {
        for (const register of r.unit.services ?? []) {
          register(inner);
        }
      },
      { router: { interceptors: [asAdmin] } },
    );
    const client = createClient(FederationIssuerCommandController, transport);

    const saved = await client.create(
      create(FederationIssuerSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "FederationIssuer",
        metadata: create(ApiResourceMetadataSchema, { name: "Acme Platform", org: "acme" }),
        spec: create(FederationIssuerSpecSchema, {
          displayName: "Acme Platform",
          jwksUri: JWKS,
          allowedIssuers: [`${ISSUER}/`],
          expectedAudience: AUDIENCE,
        }),
      }),
    );

    expect(saved.metadata?.id).toMatch(/^fis_/);
    expect(r.dialed).toEqual([DISCOVERY, JWKS]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("a token naming the provider has its keys fetched through it, and a first sign-in reads the profile through it", async () => {
    const store = new InMemoryIssuerStore();
    await store.insert(jitIssuer());
    const r = rig(store);
    const [verifier] = r.unit.identityVerifiers ?? [];

    const identity = await verifier?.verify(signedToken());

    expect(identity?.identityId).toBe("ida_dana");
    expect(r.created[0]?.spec?.email).toBe("dana@acme.test");
    expect(r.dialed).toEqual([JWKS, USERINFO]);
    expect(globalFetch).not.toHaveBeenCalled();
  });
});
