/**
 * Pins the store-backed federated verifier over a mock JWKS. The crypto
 * lane: claim-or-pass, kid-selected RS256, expiry, the plain-error
 * JWKS-outage contract, and the Unauthenticated answer when the egress
 * policy refuses the provider's JWKS address, with fixed copy that names
 * no resolved address. Then routing and provisioning: route resolution
 * from the FederationIssuer store, a token going to the
 * one provider whose issuer AND audience it carries (two organizations on
 * one issuer each get their own users; an audience nobody registered, a
 * provider with no audience or naming a reserved issuer, route nothing;
 * two providers on one route refuse the token and warn once),
 * account-id identity minting (never the raw sub), the refusal of a first
 * sign-in when the provider creates no accounts, account creation with the
 * sign-in role granted, and the rollback-on-grant-failure atomicity
 * guarantee. A stored owner sign-in role never grants: the sign-in is
 * refused, nothing is recorded and the account rolls back. A
 * provider whose organization is gone, or was created after the provider
 * (its slug freed by a delete and taken again), routes nothing and is
 * logged once per rebuild, since its grants would land in whoever holds
 * the slug now (organization-links.ts `orphanReason`). The issuer cache:
 * a provider write reaches the lane when the writer invalidates it, or
 * once the TTL passes, and not before; the providers are read once per
 * TTL however many tokens arrive.
 *
 * What a token must carry: a subject, and a numeric `exp`; a token
 * without either is refused before any account is read or made. A token
 * whose `nbf` is still in the future, or is not a number, is refused as
 * not yet valid, and one whose `nbf` has passed is admitted. The
 * signature is RS256 whatever the header names, so an unsigned token
 * (`alg: none`) and an HS256 token keyed by the provider's own public key
 * are refused like any bad signature. Binding: every token carries the
 * organization it works in: the child of the provider's organization whose
 * external id its claim carries, or the provider's own; a claim that is
 * missing, not a string, or names no child of the provider's organization
 * (another parent's child included) refuses the sign-in, returning or first, before any account is made,
 * naming the claim and never its value. Grants: the
 * sign-in role is granted on an account's first sign-in to each
 * organization and never again, once under concurrent first sign-ins, a
 * removed role staying removed; no role grants nothing; a failed grant
 * releases the first sign-in so the next one tries again. A provider's
 * delete: a sign-in that wrote anything reads the provider again before it
 * answers, and one whose provider is being deleted is refused and undoes
 * its own write, removing an account it created through the account
 * service and revoking only the grant it made on an account that already
 * existed, each acting for the provider; every sign-in reads its
 * provider once the token is proven, so a routing cache that still holds a
 * provider no longer live signs no one in, and a sign-in that wrote reads
 * it once more; the read before any write that faults is an
 * infrastructure fault (a plain Error, INTERNAL through the chain) with
 * nothing written, while the read after a write that faults counts as not
 * live, so the sign-in is refused, the write undone and the person asked to
 * retry; an undo step that fails is logged and the sign-in still refused,
 * and so is a failed release of a first sign-in after a failed grant. The profile is the token's email first and the userinfo
 * endpoint only when the token has none; a failed userinfo read answers
 * fixed copy and logs its cause, and a token with neither is refused
 * before an account is made.
 */
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { Code, ConnectError } from "@connectrpc/connect";
import { asFetch, guardedFetch } from "@stigmer/outbound/egress";
import { strictEgressPolicy } from "@stigmer/server";
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";

import { FederationIssuerSchema } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import type { FederationIssuer } from "@stigmer/apis/ai/stigmer/iam/federationissuer/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { GrantSpec } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import type { GrantPathClient } from "../../grant/grant-path-client.js";
import type {
  IdentityAccountService,
  NewAccountRequest,
} from "../../account/port.js";
import type { OrganizationFacts, OrganizationLookup } from "../../organization-links.js";
import type { FederationIssuerStore } from "../../issuer/store.js";
import { SILENT_LOGGER } from "../../../__test-utils__/refusing-doubles.js";
import { newJwksKeyCache } from "../../../verifiers/jwks.js";
import {
  inMemorySignInGrants,
  type InMemorySignInGrants,
} from "./in-memory-sign-in-grants.js";
import type { UserProfile } from "../userinfo.js";
import { ISSUER_CACHE_TTL_MS, newStoreBackedFederatedVerifier } from "../verifier.js";

const idpKey = generateKeyPairSync("rsa", { modulusLength: 2048 });

const ISSUER = "https://sso.customer.test";
/** When every fixture provider was created, and when every organization the default lookup knows was. */
const PROVIDER_CREATED = new Date("2026-09-10T00:00:00Z");
const ORG_CREATED = new Date("2026-09-01T00:00:00Z");
const AUDIENCE = "https://api.customer.test/stigmer";
const USERINFO = "https://sso.customer.test/userinfo";

function provider(overrides?: {
  createAccounts?: boolean;
  signInRole?: IamRole;
  externalIdClaim?: string;
  /** The STORED issuer spellings (the handlers normalize on save; a row whose issuer spelling was never normalized may not be). */
  allowedIssuers?: string[];
  audience?: string;
  metadata?: { id: string; org: string; slug: string };
  userinfoEndpoint?: string;
}): FederationIssuer {
  return create(FederationIssuerSchema, {
    metadata: overrides?.metadata ?? { id: "fis_1", org: "acme", slug: "acme-sso" },
    status: { audit: { specAudit: { createdAt: timestampFromDate(PROVIDER_CREATED) } } },
    spec: {
      jwksUri: "https://sso.customer.test/jwks",
      userinfoEndpoint: overrides?.userinfoEndpoint ?? "",
      allowedIssuers: overrides?.allowedIssuers ?? [ISSUER],
      expectedAudience: overrides?.audience ?? AUDIENCE,
      createAccountsOnSignIn: overrides?.createAccounts ?? false,
      signInRole: overrides?.signInRole ?? IamRole.iam_role_unspecified,
      externalIdClaim: overrides?.externalIdClaim ?? "",
    },
  });
}

function jwksFetch(): typeof fetch {
  const jwk = idpKey.publicKey.export({ format: "jwk" });
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] })),
    );
}

/** A compact JWT over any header, signed by `signature` over its first two parts. */
function compact(
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
  signature: (signedPart: string) => Buffer,
): string {
  const head = Buffer.from(JSON.stringify(header)).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${head}.${body}.${signature(`${head}.${body}`).toString("base64url")}`;
}

function sign(payload: Record<string, unknown>, kid = "k1"): string {
  return compact({ alg: "RS256", kid }, payload, (signedPart) => {
    const signer = createSign("RSA-SHA256");
    signer.update(signedPart);
    return signer.sign(idpKey.privateKey);
  });
}

const CLAIMS = {
  iss: ISSUER,
  // Auth0's array form: the API's audience beside the issuer's userinfo URL.
  aud: [AUDIENCE, `${ISSUER}/userinfo`],
  sub: "okta|user-1",
  exp: Math.floor(Date.now() / 1000) + 3600,
  email: "sso@customer.test",
  given_name: "S",
  family_name: "User",
};

interface Fakes {
  providers: FederationIssuer[];
  accountsByNaturalKey: Map<string, IdentityAccount>;
  created: NewAccountRequest[];
  deleted: string[];
  grants: GrantSpec[];
  /** The grant refuses: with an Error, or (`"non-error"`) with a bare value. */
  grantFails: boolean | "non-error";
  /** The rollback's account delete refuses. */
  deleteFails: boolean;
  /** Account creation loses a race: it refuses, and this account (keyed by natural key) now exists. */
  createRace: { readonly key: string; readonly account: IdentityAccount } | undefined;
  /** The provider organization's children, by external id; another parent's children never answer. */
  childByExternalId: Map<string, { readonly parent: string; readonly id: string }>;
  /** How many times the verifier read every provider (an index rebuild). */
  providerReads: number;
  /** Every userinfo endpoint the lane read, in order. */
  userinfoCalls: string[];
  /** The first sign-in of each (account, organization). */
  signInGrants: InMemorySignInGrants;
  /**
   * Providers whose delete has begun: the routing read skips them, as both
   * real adapters do, and the liveness read answers them not live. A cache
   * built before the mark still routes to them until it is rebuilt.
   */
  deletingIds: Set<string>;
  /** How many times an account was read by provider and subject. */
  accountLookups: number;
  /** How many times the lane asked whether its provider is still live. */
  liveChecks: number;
  /** The account service's delete refuses. */
  accountDeleteFails: boolean;
  /** The liveness read faults from this read on (1 is the first). */
  liveCheckFailsFromRead: number | undefined;
  /** A delete marks the provider before this read (1 is the first); later reads see the mark. */
  markedFromRead: number | undefined;
  /** Every account the account service deleted, with whom it acted for. */
  accountDeletes: Array<{ readonly id: string; readonly actingFor: string | undefined }>;
  /** Every grant revoked one at a time, with whom it acted for. */
  revoked: Array<{ readonly spec: GrantSpec; readonly actingFor: string | undefined }>;
}

function newFakes(providers: FederationIssuer[]): Fakes {
  return {
    providers,
    accountsByNaturalKey: new Map(),
    created: [],
    deleted: [],
    grants: [],
    grantFails: false,
    deleteFails: false,
    createRace: undefined,
    childByExternalId: new Map(),
    providerReads: 0,
    userinfoCalls: [],
    signInGrants: inMemorySignInGrants(),
    deletingIds: new Set(),
    accountLookups: 0,
    liveChecks: 0,
    accountDeleteFails: false,
    liveCheckFailsFromRead: undefined,
    markedFromRead: undefined,
    accountDeletes: [],
    revoked: [],
  };
}

function verifierOf(
  fakes: Fakes,
  options?: {
    warnings?: string[];
    errors?: Array<{ message: string; fields: Record<string, unknown> }>;
    jwksFetch?: typeof fetch;
    reservedIssuers?: ReadonlyArray<string>;
    /** The organizations the lookup answers; absent, every organization exists and predates its providers. */
    organizations?: ReadonlyMap<string, Date | undefined>;
    /** The verifier's clock; absent, the wall clock. */
    nowMs?: () => number;
    /** The userinfo read; absent, it refuses. Every call is recorded in `userinfoCalls` first. */
    fetchUserProfile?: (endpoint: string) => Promise<UserProfile>;
  },
) {
  const providerStore: Pick<FederationIssuerStore, "findLive" | "isLive"> = {
    findLive: () => {
      fakes.providerReads += 1;
      return Promise.resolve(fakes.providers.filter((held) => !fakes.deletingIds.has(held.metadata?.id ?? "")));
    },
    isLive: (id: string) => {
      fakes.liveChecks += 1;
      if (fakes.liveCheckFailsFromRead !== undefined && fakes.liveChecks >= fakes.liveCheckFailsFromRead) {
        return Promise.reject(new Error("store unavailable"));
      }
      if (fakes.markedFromRead !== undefined && fakes.liveChecks >= fakes.markedFromRead) {
        return Promise.resolve(false);
      }
      return Promise.resolve(
        fakes.providers.some((held) => held.metadata?.id === id) && !fakes.deletingIds.has(id),
      );
    },
  };
  const accounts = {
    store: {
      findByIssuerAndIdpId: (providerId: string, sub: string) => {
        fakes.accountLookups += 1;
        return Promise.resolve(fakes.accountsByNaturalKey.get(`${providerId}:${sub}`));
      },
      deleteById: (id: string) => {
        fakes.deleted.push(id);
        return fakes.deleteFails
          ? Promise.reject(new Error("store unavailable"))
          : Promise.resolve();
      },
    },
    deleteAccount: (account: IdentityAccount, actingFor?: string) => {
      if (fakes.accountDeleteFails) {
        return Promise.reject(new Error("grant path down"));
      }
      fakes.accountDeletes.push({ id: account.metadata?.id ?? "", actingFor });
      return Promise.resolve();
    },
    createAccount: (request: NewAccountRequest) => {
      if (fakes.createRace !== undefined) {
        fakes.accountsByNaturalKey.set(fakes.createRace.key, fakes.createRace.account);
        return Promise.reject(new Error("duplicate key"));
      }
      fakes.created.push(request);
      return Promise.resolve(
        create(IdentityAccountSchema, { metadata: { id: "ida_new" } }),
      );
    },
  } as unknown as IdentityAccountService;
  // The JIT grant is a ROLE grant to a person: the user lane (`create`),
  // where ValidateGrantableRole runs; the fake offers that method only.
  const grants = {
    create: (spec: GrantSpec) => {
      if (fakes.grantFails === "non-error") {
        return Promise.reject("fga unavailable");
      }
      if (fakes.grantFails) {
        return Promise.reject(new Error("fga unavailable"));
      }
      fakes.grants.push(spec);
      return Promise.resolve(undefined as never);
    },
    delete: (spec: GrantSpec, actingFor?: string) => {
      fakes.revoked.push({ spec, actingFor });
      return Promise.resolve(undefined as never);
    },
  } as unknown as GrantPathClient;
  const childOrganizations = {
    findByExternalId: (parentId: string, externalId: string) => {
      const child = fakes.childByExternalId.get(externalId);
      return Promise.resolve(
        child !== undefined && child.parent === parentId
          ? create(OrganizationSchema, { metadata: { id: child.id }, spec: { parentOrg: parentId } })
          : undefined,
      );
    },
  };

  return newStoreBackedFederatedVerifier({
    providers: providerStore,
    accounts,
    grants,
    childOrganizations,
    signInGrants: fakes.signInGrants,
    fetchUserProfile: (endpoint: string) => {
      fakes.userinfoCalls.push(endpoint);
      return options?.fetchUserProfile?.(endpoint) ?? Promise.reject(new Error("no userinfo in tests"));
    },
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: (message: string) => {
        options?.warnings?.push(message);
      },
      error: (message: string, fields: Record<string, unknown>) => {
        options?.errors?.push({ message, fields });
      },
    } as never,
    jwks: newJwksKeyCache({ fetchImpl: options?.jwksFetch ?? jwksFetch(), logger: SILENT_LOGGER }),
    reservedIssuers: options?.reservedIssuers ?? [],
    organizations: organizationsOf(options?.organizations),
    ...(options?.nowMs === undefined ? {} : { nowMs: options.nowMs }),
  });
}

/** A lookup over `known` (organization to creation time); absent, every organization exists since ORG_CREATED. */
function organizationsOf(known?: ReadonlyMap<string, Date | undefined>): OrganizationLookup {
  return {
    find: (org): Promise<OrganizationFacts | undefined> => {
      if (known !== undefined && !known.has(org)) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        createdAt: known === undefined ? ORG_CREATED : known.get(org),
        name: org,
        slug: org,
        logoUrl: "",
        parentOrg: "",
      });
    },
  };
}

/** The Unauthenticated refusal a verify answered; anything else fails the case. */
async function refusalOf(verified: Promise<unknown>): Promise<ConnectError> {
  const caught = await verified.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ConnectError);
  expect((caught as ConnectError).code).toBe(Code.Unauthenticated);
  return caught as ConnectError;
}

describe("store-backed federated verifier", () => {
  it("passes a token that names no issuer, or an empty one (claim-or-pass)", async () => {
    const verifier = verifierOf(newFakes([provider()]));
    const { iss: _iss, ...withoutIssuer } = CLAIMS;
    expect(await verifier.verify(sign(withoutIssuer))).toBeNull();
    expect(await verifier.verify(sign({ ...CLAIMS, iss: "" }))).toBeNull();
  });

  it("passes on unknown issuers and non-JWTs (claim-or-pass)", async () => {
    const verifier = verifierOf(newFakes([provider()]));
    expect(await verifier.verify("plain-token")).toBeNull();
    expect(
      await verifier.verify(sign({ ...CLAIMS, iss: "https://other.test" })),
    ).toBeNull();
  });

  it("mints the ACCOUNT id for an existing federated account", async () => {
    const fakes = newFakes([provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_existing" } }),
    );
    const identity = await verifierOf(fakes).verify(sign(CLAIMS));
    expect(identity?.identityId).toBe("ida_existing");
    expect(identity?.callerClass).toBe("user");
  });

  // Issuer spelling: the issuer is normalized at WRITE time and again at
  // LOOKUP time, so the Auth0-shaped `iss` with its trailing slash
  // resolves against the canonical stored value. The three arms pin both
  // sides of the lookup and the collision posture of the rebuild.
  it("resolves an Auth0-shaped issuer (trailing slash) against the canonical stored value", async () => {
    const fakes = newFakes([provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_existing" } }),
    );
    const identity = await verifierOf(fakes).verify(
      sign({ ...CLAIMS, iss: `${ISSUER}/` }),
    );
    expect(identity?.identityId).toBe("ida_existing");
  });

  it("resolves a canonical issuer against a stored spelling that was never normalized", async () => {
    const fakes = newFakes([provider({ allowedIssuers: [`${ISSUER}/`] })]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_existing" } }),
    );
    const identity = await verifierOf(fakes).verify(sign(CLAIMS));
    expect(identity?.identityId).toBe("ida_existing");
  });

  it("refuses a token two never-normalized providers' routes both match, and warns once for the rows", async () => {
    const fakes = newFakes([
      provider(),
      provider({
        allowedIssuers: [`${ISSUER}/`],
        metadata: { id: "fis_2", org: "beta", slug: "beta-sso" },
      }),
    ]);
    const warnings: string[] = [];
    const verifier = verifierOf(fakes, { warnings });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const refused = await verifier.verify(sign(CLAIMS)).then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(refused).toBeInstanceOf(ConnectError);
      expect((refused as ConnectError).code).toBe(Code.Unauthenticated);
      expect((refused as ConnectError).rawMessage).toBe(
        `token from issuer '${ISSUER}' matches more than one federation issuer`,
      );
    }
    expect(warnings).toEqual(["two federation issuers share one route; tokens on it are refused"]);
  });

  it("routes each organization's tokens to its own provider when two share an issuer", async () => {
    const fakes = newFakes([
      provider(),
      provider({ audience: "https://api.beta.test/stigmer", metadata: { id: "fis_2", org: "beta", slug: "beta-sso" } }),
    ]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_acme" } }),
    );
    fakes.accountsByNaturalKey.set(
      "fis_2:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_beta" } }),
    );
    const verifier = verifierOf(fakes);
    expect((await verifier.verify(sign(CLAIMS)))?.identityId).toBe("ida_acme");
    expect(
      (await verifier.verify(sign({ ...CLAIMS, aud: "https://api.beta.test/stigmer" })))?.identityId,
    ).toBe("ida_beta");
  });

  it("passes a token whose audience no provider registered at its issuer, and logs nothing", async () => {
    const warnings: string[] = [];
    const errors: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const verifier = verifierOf(newFakes([provider()]), { warnings, errors });
    expect(await verifier.verify(sign({ ...CLAIMS, aud: "https://another.test/api" }))).toBeNull();
    expect(await verifier.verify(sign({ ...CLAIMS, aud: undefined }))).toBeNull();
    expect(warnings).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("routes nothing to a stored provider with no audience, or one naming a reserved issuer, and warns at rebuild", async () => {
    const warnings: string[] = [];
    const noAudience = verifierOf(newFakes([provider({ audience: "" })]), { warnings });
    expect(await noAudience.verify(sign(CLAIMS))).toBeNull();
    expect(warnings).toEqual(["federation issuer has no audience and routes no token; an admin must set one"]);

    const reservedWarnings: string[] = [];
    const reserved = verifierOf(newFakes([provider()]), {
      warnings: reservedWarnings,
      reservedIssuers: [`${ISSUER}/`],
    });
    expect(await reserved.verify(sign(CLAIMS))).toBeNull();
    expect(reservedWarnings).toEqual([
      "federation issuer names this platform's own sign-in issuer and routes no token",
    ]);
  });

  it("refuses a first sign-in when the provider does not create accounts", async () => {
    const fakes = newFakes([provider()]);
    await refusalOf(verifierOf(fakes).verify(sign(CLAIMS)));
    expect(fakes.created).toEqual([]);
  });

  it("creates the account from the token's claims, binds the token to the provider's organization and grants its sign-in role there", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    const identity = await verifierOf(fakes).verify(sign(CLAIMS));
    expect(identity?.identityId).toBe("ida_new");
    expect(identity?.boundOrg).toBe("acme");
    expect(fakes.created[0].spec.email).toBe("sso@customer.test");
    expect(fakes.created[0].spec.federationIssuerRef?.id).toBe("fis_1");
    expect(fakes.grants.map((grant) => [grant.relation, grant.resource?.id])).toEqual([["viewer", "acme"]]);
    expect([...fakes.signInGrants.rows.keys()]).toEqual(["ida_new:acme"]);
  });

  it.each([
    ["admin", IamRole.admin],
    ["member", IamRole.member],
  ])("grants a sign-in role of %s", async (relation, signInRole) => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole })]);
    await verifierOf(fakes).verify(sign(CLAIMS));
    expect(fakes.grants.map((grant) => grant.relation)).toEqual([relation]);
  });

  it("creates an account with no sign-in role, grants it nothing and still records its first sign-in", async () => {
    const fakes = newFakes([provider({ createAccounts: true })]);
    const identity = await verifierOf(fakes).verify(sign(CLAIMS));
    expect(identity?.identityId).toBe("ida_new");
    expect(fakes.grants).toEqual([]);
    expect([...fakes.signInGrants.rows.keys()]).toEqual(["ida_new:acme"]);
  });

  it("makes a first sign-in its provider's viewer sign-in role on the provider's own organization", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    const identity = await verifierOf(fakes).verify(sign(CLAIMS));
    expect(identity?.boundOrg).toBe("acme");
    expect(fakes.grants.map((grant) => [grant.relation, grant.resource?.id])).toEqual([["viewer", "acme"]]);
  });

  it("never grants a stored owner sign-in role: the sign-in is refused, nothing is recorded and the account rolls back", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.owner })]);
    const refused = await refusalOf(verifierOf(fakes).verify(sign(CLAIMS)));
    expect(refused.rawMessage).toContain("sign_in_role");
    expect(fakes.grants).toEqual([]);
    expect(fakes.signInGrants.rows.size).toBe(0);
    expect(fakes.deleted).toEqual(["ida_new"]);
  });

  it("rolls the account back and releases its first sign-in when the grant fails", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.grantFails = true;
    await refusalOf(verifierOf(fakes).verify(sign(CLAIMS)));
    expect(fakes.deleted).toEqual(["ida_new"]);
    expect(fakes.signInGrants.rows.size).toBe(0);
  });

  it("refuses with the same copy when the grant fails with a bare value and the rollback's delete fails too, logging the cause", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.grantFails = "non-error";
    fakes.deleteFails = true;
    const errors: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const refused = await refusalOf(verifierOf(fakes, { errors }).verify(sign(CLAIMS)));
    expect(refused.code).toBe(Code.Unauthenticated);
    expect(refused.rawMessage).toContain("the sign-in role grant failed and the account was rolled back");
    expect(errors.map((e) => e.fields.error)).toContain("fga unavailable");
    expect(fakes.deleted).toEqual(["ida_new"]);
    expect(fakes.signInGrants.rows.size).toBe(0);
  });

  it("still refuses the sign-in when releasing the claimed first sign-in fails after a failed grant", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.grantFails = true;
    fakes.signInGrants.release = () => Promise.reject(new Error("ledger unavailable"));
    const errors: Array<{ message: string; fields: Record<string, unknown> }> = [];
    const refused = await refusalOf(verifierOf(fakes, { errors }).verify(sign(CLAIMS)));
    expect(refused.code).toBe(Code.Unauthenticated);
    expect(refused.rawMessage).toContain("the sign-in role grant failed");
    expect(fakes.deleted).toEqual(["ida_new"]);
    expect(errors.find((logged) => logged.message.includes("could not release"))).toEqual({
      message: "a failed sign-in could not release its first sign-in; the next sign-in to the organization grants nothing",
      fields: { accountId: "ida_new", org: "acme", provider: "fis_1", error: "ledger unavailable" },
    });
  });

  it("never rolls back an account a concurrent sign-in created when this one loses the creation race and its grant fails", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.createRace = {
      key: "fis_1:okta|user-1",
      account: create(IdentityAccountSchema, { metadata: { id: "ida_winner" } }),
    };
    fakes.grantFails = true;
    const refused = await refusalOf(verifierOf(fakes).verify(sign(CLAIMS)));
    expect(refused.code).toBe(Code.Unauthenticated);
    expect(refused.rawMessage).not.toContain("rolled back");
    expect(fakes.deleted, "the winner's account is not this request's to delete").toEqual([]);
  });

  it("binds the token to the child organization its claim names, and grants the sign-in role there", async () => {
    const fakes = newFakes([
      provider({ createAccounts: true, signInRole: IamRole.member, externalIdClaim: "org_id" }),
    ]);
    fakes.childByExternalId.set("tenant-42", { parent: "acme", id: "org_tenant42" });
    const identity = await verifierOf(fakes).verify(sign({ ...CLAIMS, org_id: "tenant-42" }));
    expect(identity?.boundOrg).toBe("org_tenant42");
    expect(fakes.grants.map((grant) => [grant.relation, grant.resource?.id])).toEqual([
      ["member", "org_tenant42"],
    ]);
  });

  it("binds a child organization's token without granting when the provider names no sign-in role", async () => {
    const fakes = newFakes([provider({ externalIdClaim: "org_id" })]);
    fakes.childByExternalId.set("tenant-42", { parent: "acme", id: "org_tenant42" });
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_existing" } }),
    );
    const identity = await verifierOf(fakes).verify(sign({ ...CLAIMS, org_id: "tenant-42" }));
    expect(identity?.boundOrg).toBe("org_tenant42");
    expect(fakes.grants).toEqual([]);
  });

  it.each([
    ["missing", {}],
    ["not a string", { org_id: 42 }],
    ["no child of the provider's organization", { org_id: "tenant-unmapped" }],
    ["another parent's child", { org_id: "tenant-elsewhere" }],
  ])("refuses a first sign-in whose external id claim is %s before any account is made, naming the claim and never its value", async (_case, claim) => {
    const fakes = newFakes([
      provider({ createAccounts: true, signInRole: IamRole.viewer, externalIdClaim: "org_id" }),
    ]);
    fakes.childByExternalId.set("tenant-42", { parent: "acme", id: "org_tenant42" });
    fakes.childByExternalId.set("tenant-elsewhere", { parent: "globex", id: "org_globex_child" });
    const refused = await refusalOf(verifierOf(fakes).verify(sign({ ...CLAIMS, ...claim })));
    expect(refused.rawMessage).toContain("'org_id'");
    expect(refused.rawMessage).not.toContain("tenant-unmapped");
    expect(refused.rawMessage).not.toContain("tenant-elsewhere");
    expect(fakes.created).toEqual([]);
    expect(fakes.grants).toEqual([]);
    expect(fakes.deleted).toEqual([]);
  });
});

describe("a returning account's token is bound on every sign-in", () => {
  /** A provider routing to child organizations, an account it already made, and two children. */
  function returning(signInRole = IamRole.member): Fakes {
    const fakes = newFakes([provider({ createAccounts: true, signInRole, externalIdClaim: "org_id" })]);
    fakes.childByExternalId.set("alpha", { parent: "acme", id: "org_alpha" });
    fakes.childByExternalId.set("beta", { parent: "acme", id: "org_beta" });
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_alice" } }),
    );
    return fakes;
  }

  it("binds each token to the child organization it names, whichever the account first signed in to", async () => {
    const fakes = returning();
    const verifier = verifierOf(fakes);
    expect((await verifier.verify(sign({ ...CLAIMS, org_id: "alpha" })))?.boundOrg).toBe("org_alpha");
    expect((await verifier.verify(sign({ ...CLAIMS, org_id: "beta" })))?.boundOrg).toBe("org_beta");
  });

  it.each([
    ["missing", {}],
    ["mapped to no organization", { org_id: "gamma" }],
  ])("refuses a returning account's token whose external id claim is %s", async (_case, claim) => {
    const fakes = returning();
    await refusalOf(verifierOf(fakes).verify(sign({ ...CLAIMS, ...claim })));
    expect(fakes.grants).toEqual([]);
  });

  it("grants the sign-in role on a child organization's first sign-in only, so a removed role stays removed", async () => {
    const fakes = returning();
    const verifier = verifierOf(fakes);
    await verifier.verify(sign({ ...CLAIMS, org_id: "alpha" }));
    await verifier.verify(sign({ ...CLAIMS, org_id: "alpha" }));
    await verifier.verify(sign({ ...CLAIMS, org_id: "beta" }));
    expect(fakes.grants.map((grant) => grant.resource?.id)).toEqual(["org_alpha", "org_beta"]);

    // An admin removes the role in alpha; the row stays, so nothing returns it.
    fakes.grants.length = 0;
    await verifier.verify(sign({ ...CLAIMS, org_id: "alpha" }));
    expect(fakes.grants).toEqual([]);
  });

  it("grants once under two concurrent first sign-ins to one child organization", async () => {
    const fakes = returning();
    const verifier = verifierOf(fakes);
    await Promise.all([
      verifier.verify(sign({ ...CLAIMS, org_id: "beta" })),
      verifier.verify(sign({ ...CLAIMS, org_id: "beta" })),
    ]);
    expect(fakes.grants.map((grant) => grant.resource?.id)).toEqual(["org_beta"]);
  });

  it("refuses the sign-in and releases the first sign-in when the grant fails, keeping the account", async () => {
    const fakes = returning();
    fakes.grantFails = true;
    await refusalOf(verifierOf(fakes).verify(sign({ ...CLAIMS, org_id: "beta" })));
    expect(fakes.deleted).toEqual([]);
    expect(fakes.signInGrants.rows.size).toBe(0);

    fakes.grantFails = false;
    await verifierOf(fakes).verify(sign({ ...CLAIMS, org_id: "beta" }));
    expect(fakes.grants.map((grant) => grant.resource?.id)).toEqual(["org_beta"]);
  });
});

describe("a sign-in whose provider's delete has begun", () => {
  it("refuses a first sign-in whose provider is deleted while it signs in, and leaves no account, grant or first-sign-in record", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.markedFromRead = 2; // the mark lands between the first read and the write

    const refused = await refusalOf(verifierOf(fakes).verify(sign(CLAIMS)));
    expect(refused.rawMessage).toBe("IdP 'acme/acme-sso' is being deleted and signs no one in");
    expect(
      fakes.accountDeletes,
      "the account it created goes through the account service, grants and all, acting for the provider",
    ).toEqual([{ id: "ida_new", actingFor: "fis_1" }]);
    expect(fakes.deleted, "never the row-only rollback, which would leave the grant").toEqual([]);
    expect(fakes.signInGrants.rows.size).toBe(0);
  });

  it("revokes the one grant a returning account's first sign-in to a child made while its provider is deleted, and keeps the account", async () => {
    const fakes = newFakes([
      provider({ createAccounts: true, signInRole: IamRole.member, externalIdClaim: "org_id" }),
    ]);
    fakes.childByExternalId.set("alpha", { parent: "acme", id: "org_alpha" });
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_alice" } }),
    );
    fakes.markedFromRead = 2;

    await refusalOf(verifierOf(fakes).verify(sign({ ...CLAIMS, org_id: "alpha" })));
    expect(fakes.revoked.map(({ spec, actingFor }) => [spec.relation, spec.resource?.id, spec.principal?.id, actingFor])).toEqual([
      ["member", "org_alpha", "ida_alice", "fis_1"],
    ]);
    expect(fakes.accountDeletes, "an account that already existed is the removal's to delete").toEqual([]);
    expect(fakes.signInGrants.rows.size).toBe(0);
  });

  it("still refuses, and still releases the first sign-in, when undoing the account fails, logging the step", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.markedFromRead = 2;
    fakes.accountDeleteFails = true;
    const errors: Array<{ message: string; fields: Record<string, unknown> }> = [];

    const refused = await refusalOf(verifierOf(fakes, { errors }).verify(sign(CLAIMS)));
    expect(refused.rawMessage).toBe("IdP 'acme/acme-sso' is being deleted and signs no one in");
    expect(errors).toEqual([
      {
        message: "a sign-in through a federation issuer being deleted could not undo its write",
        fields: { step: "delete the account", accountId: "ida_new", idp: "acme/acme-sso", error: "grant path down" },
      },
    ]);
    expect(fakes.signInGrants.rows.size, "the next step still ran").toBe(0);
  });

  it("takes a liveness read that faults after a write as not live: undoes the write, logs the cause and asks for a retry", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.liveCheckFailsFromRead = 2;
    const errors: Array<{ message: string; fields: Record<string, unknown> }> = [];

    const refused = await refusalOf(verifierOf(fakes, { errors }).verify(sign(CLAIMS)));
    expect(refused.rawMessage).toBe("Failed to complete sign-in from IdP 'acme/acme-sso'. Please retry authentication.");
    expect(fakes.accountDeletes).toEqual([{ id: "ida_new", actingFor: "fis_1" }]);
    expect(fakes.signInGrants.rows.size).toBe(0);
    expect(errors.map((logged) => logged.message)).toEqual([
      "could not read whether a sign-in's federation issuer is live; the sign-in is refused",
    ]);
  });

  it("passes, once routed again and without reading an account, a token a routing cache sends through a provider no longer live", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    const verifier = verifierOf(fakes);
    await verifier.verify(sign({ ...CLAIMS, sub: "okta|warm-up" })); // the cache now holds fis_1
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_returning" } }),
    );
    fakes.deletingIds.add("fis_1"); // its delete has begun; this process's cache still routes it
    const lookupsBefore = fakes.accountLookups;

    expect(await verifier.verify(sign(CLAIMS)), "routed again, the token names no live provider").toBeNull();
    expect(fakes.accountLookups, "no account is read through a provider no longer live").toBe(lookupsBefore);
    expect(fakes.grants.map((grant) => grant.principal?.id)).not.toContain("ida_returning");
  });

  it("forgets a cached provider that is gone and routes the token once more, to the provider created since on its route", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    const verifier = verifierOf(fakes);
    await verifier.verify(sign({ ...CLAIMS, sub: "okta|warm-up" })); // the cache now holds fis_1
    const readsBefore = fakes.providerReads;

    // fis_1 is deleted and the slug taken again by fis_2, on the same route.
    fakes.providers = [
      provider({
        createAccounts: true,
        signInRole: IamRole.viewer,
        metadata: { id: "fis_2", org: "acme", slug: "acme-sso" },
      }),
    ];
    // The new provider's accounts are keyed by its own id.
    fakes.accountsByNaturalKey.set(
      "fis_2:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_of_idp_2" } }),
    );

    const identity = await verifier.verify(sign(CLAIMS));
    expect(identity?.identityId).toBe("ida_of_idp_2");
    expect(fakes.providerReads, "the cache was rebuilt for this token").toBe(readsBefore + 1);
  });

  it("answers a fault of the read before any write as an infrastructure fault, logging it and writing nothing", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    fakes.liveCheckFailsFromRead = 1;
    const errors: Array<{ message: string; fields: Record<string, unknown> }> = [];

    const caught = await verifierOf(fakes, { errors })
      .verify(sign(CLAIMS))
      .then(
        () => undefined,
        (error: unknown) => error,
      );
    expect(caught, "a plain Error, which the verifier chain answers INTERNAL").not.toBeInstanceOf(ConnectError);
    expect((caught as Error).message).toBe("could not read whether federation issuer 'acme/acme-sso' is live");
    expect(errors.map((logged) => [logged.message, logged.fields.error])).toEqual([
      ["could not read whether a sign-in's federation issuer is live", "store unavailable"],
    ]);
    expect(fakes.created).toEqual([]);
    expect(fakes.grants).toEqual([]);
  });

  it("releases, and revokes nothing, a returning account's first sign-in that recorded no grant while its provider is deleted", async () => {
    const fakes = newFakes([provider({ externalIdClaim: "org_id" })]);
    fakes.childByExternalId.set("alpha", { parent: "acme", id: "org_alpha" });
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_alice" } }),
    );
    fakes.markedFromRead = 2;

    const refused = await refusalOf(verifierOf(fakes).verify(sign({ ...CLAIMS, org_id: "alpha" })));
    expect(refused.rawMessage).toBe("IdP 'acme/acme-sso' is being deleted and signs no one in");
    expect(fakes.revoked).toEqual([]);
    expect(fakes.accountDeletes).toEqual([]);
    expect(fakes.signInGrants.rows.size, "the first sign-in it recorded is released").toBe(0);
  });

  it("reads its provider once on a sign-in that writes nothing, and once more after one that writes", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    const verifier = verifierOf(fakes);
    await verifier.verify(sign(CLAIMS));
    expect(fakes.liveChecks, "the first sign-in wrote, so it read before and after").toBe(2);

    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_new" } }),
    );
    await verifier.verify(sign(CLAIMS));
    expect(fakes.liveChecks, "a returning sign-in with its grant recorded reads once").toBe(3);
  });
});

describe("store-backed federated verifier: the profile and the token's shape", () => {
  it("takes the profile from the token's email first, and reads the userinfo endpoint only when the token carries none", async () => {
    const fromEndpoint: UserProfile = {
      email: "profile@customer.test",
      firstName: "P",
      lastName: "Rofile",
      pictureUrl: "",
    };
    const readsEndpoint = { fetchUserProfile: () => Promise.resolve(fromEndpoint) };

    const withEmail = newFakes([provider({ createAccounts: true, userinfoEndpoint: USERINFO })]);
    await verifierOf(withEmail, readsEndpoint).verify(sign(CLAIMS));
    expect(withEmail.userinfoCalls).toEqual([]);
    expect(withEmail.created[0].spec.email).toBe("sso@customer.test");

    const withoutEmail = newFakes([provider({ createAccounts: true, userinfoEndpoint: USERINFO })]);
    await verifierOf(withoutEmail, readsEndpoint).verify(sign({ ...CLAIMS, email: undefined }));
    expect(withoutEmail.userinfoCalls).toEqual([USERINFO]);
    expect(withoutEmail.created[0].spec.email).toBe("profile@customer.test");
  });

  it("answers a failed userinfo read with fixed copy, logs its cause, and makes no account", async () => {
    const fakes = newFakes([provider({ createAccounts: true, userinfoEndpoint: USERINFO })]);
    const warnings: string[] = [];
    const verifier = verifierOf(fakes, {
      warnings,
      fetchUserProfile: () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:443")),
    });
    const refused = await refusalOf(verifier.verify(sign({ ...CLAIMS, email: undefined })));
    expect(refused.rawMessage).toBe(
      "Cannot auto-provision account for IdP 'acme/acme-sso': its userinfo endpoint could not be read",
    );
    expect(refused.rawMessage).not.toContain("10.0.0.5");
    expect(warnings).toEqual(["federated userinfo fetch failed"]);
    expect(fakes.created).toEqual([]);
  });

  it("refuses a first sign-in whose token carries no email when no userinfo endpoint is configured, and makes no account", async () => {
    const fakes = newFakes([provider({ createAccounts: true })]);
    const refused = await refusalOf(verifierOf(fakes).verify(sign({ ...CLAIMS, email: undefined })));
    expect(refused.rawMessage).toMatch(/^Cannot resolve profile for user from IdP 'acme\/acme-sso'/);
    expect(fakes.userinfoCalls).toEqual([]);
    expect(fakes.created).toEqual([]);
  });

  it("throws Unauthenticated on expiry and bad signatures", async () => {
    const fakes = newFakes([provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_x" } }),
    );
    const verifier = verifierOf(fakes);
    await expect(
      verifier.verify(
        sign({ ...CLAIMS, exp: Math.floor(Date.now() / 1000) - 60 }),
      ),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof ConnectError && error.code === Code.Unauthenticated,
    );
    await expect(
      verifier.verify(sign(CLAIMS, "unknown-kid")),
    ).rejects.toSatisfy(
      (error) =>
        error instanceof ConnectError && error.code === Code.Unauthenticated,
    );
  });

  it("refuses a token with no subject, or an empty one, before an account is read or made", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    const verifier = verifierOf(fakes);
    for (const sub of [undefined, ""]) {
      const refused = await refusalOf(verifier.verify(sign({ ...CLAIMS, sub })));
      expect(refused.rawMessage).toBe(`token from issuer '${ISSUER}' carries no subject`);
    }
    expect(fakes.created).toEqual([]);
    expect(fakes.grants).toEqual([]);
  });

  it("refuses a token with no exp, or one that is not a number, as expired", async () => {
    const fakes = newFakes([provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_x" } }),
    );
    const verifier = verifierOf(fakes);
    for (const exp of [undefined, String(CLAIMS.exp)]) {
      const refused = await refusalOf(verifier.verify(sign({ ...CLAIMS, exp })));
      expect(refused.rawMessage).toBe(`token from issuer '${ISSUER}' is expired`);
    }
  });

  it("refuses a token before its nbf, or with an nbf that is not a number, and admits one after it", async () => {
    const fakes = newFakes([provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_x" } }),
    );
    const verifier = verifierOf(fakes);
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const nbf of [nowSeconds + 300, String(nowSeconds - 60)]) {
      const refused = await refusalOf(verifier.verify(sign({ ...CLAIMS, nbf })));
      expect(refused.rawMessage).toBe(`token from issuer '${ISSUER}' is not yet valid`);
    }
    const admitted = await verifier.verify(sign({ ...CLAIMS, nbf: nowSeconds - 60 }));
    expect(admitted?.identityId).toBe("ida_x");
  });

  it("verifies RS256 whatever the header names: an unsigned token, and an HS256 one keyed by the provider's public key, are refused", async () => {
    const fakes = newFakes([provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_x" } }),
    );
    const verifier = verifierOf(fakes);
    const publicPem = idpKey.publicKey.export({ type: "spki", format: "pem" });
    const unsigned = compact({ alg: "none", kid: "k1" }, CLAIMS, () => Buffer.alloc(0));
    const keyedByPublicKey = compact({ alg: "HS256", kid: "k1" }, CLAIMS, (signedPart) =>
      createHmac("sha256", publicPem).update(signedPart).digest(),
    );
    for (const token of [unsigned, keyedByPublicKey]) {
      const refused = await refusalOf(verifier.verify(token));
      expect(refused.rawMessage).toBe(`token from issuer '${ISSUER}' failed signature verification`);
    }
  });

  it("answers Unauthenticated with fixed copy when the provider's JWKS address is refused", async () => {
    const warnings: string[] = [];
    const verifier = verifierOf(newFakes([provider()]), {
      warnings,
      jwksFetch: asFetch(
        guardedFetch(strictEgressPolicy(), {
          fetchImpl: jwksFetch(),
          lookup: () => Promise.resolve(["10.0.0.5"]),
        }),
      ),
    });
    const error = await verifier.verify(sign(CLAIMS)).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Unauthenticated);
    expect((error as ConnectError).rawMessage).toBe(
      `the federation issuer for issuer '${ISSUER}' names a JWKS address this platform does not dial`,
    );
    expect((error as ConnectError).rawMessage).not.toContain("10.0.0.5");
    // Like the lane's other refusals, a refused token logs nothing: a
    // per-token line would let any organization admin flood the logs.
    expect(warnings).toEqual([]);
  });

  it("throws a PLAIN error on a JWKS outage (infrastructure fault)", async () => {
    const fakes = newFakes([provider()]);
    const providerStore: Pick<FederationIssuerStore, "findLive" | "isLive"> = {
      findLive: () => Promise.resolve(fakes.providers),
      isLive: () => Promise.resolve(true),
    };
    const verifier = newStoreBackedFederatedVerifier({
      providers: providerStore,
      accounts: { store: {} } as never,
      grants: {} as never,
      childOrganizations: {} as never,
      signInGrants: inMemorySignInGrants(),
      fetchUserProfile: () => Promise.reject(new Error("unused")),
      logger: {
        debug: () => undefined,
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
      } as never,
      jwks: newJwksKeyCache({
        fetchImpl: () => Promise.reject(new Error("connect ETIMEDOUT")),
        logger: SILENT_LOGGER,
      }),
      reservedIssuers: [],
      organizations: organizationsOf(),
    });
    await expect(verifier.verify(sign(CLAIMS))).rejects.toSatisfy(
      (error) => error instanceof Error && !(error instanceof ConnectError),
    );
  });
});

describe("the issuer cache: provider writes reach the lane by invalidation, or at the TTL", () => {
  /** A known account for the default provider's subject, so a routed token resolves without provisioning. */
  function withAccount(fakes: Fakes): Fakes {
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_existing" } }),
    );
    return fakes;
  }

  it("routes a provider added after the first token only once invalidated, or once the TTL has passed", async () => {
    let now = Date.now();
    const fakes = withAccount(newFakes([]));
    const verifier = verifierOf(fakes, { nowMs: () => now });
    expect(await verifier.verify(sign(CLAIMS))).toBeNull();

    fakes.providers.push(provider());
    expect(await verifier.verify(sign(CLAIMS)), "inside the TTL, the index is the one read before").toBeNull();
    verifier.invalidate();
    expect((await verifier.verify(sign(CLAIMS)))?.identityId).toBe("ida_existing");

    const untold = withAccount(newFakes([]));
    const byClock = verifierOf(untold, { nowMs: () => now });
    expect(await byClock.verify(sign(CLAIMS))).toBeNull();
    untold.providers.push(provider());
    now += ISSUER_CACHE_TTL_MS;
    expect((await byClock.verify(sign(CLAIMS)))?.identityId, "the TTL rebuilds the index untold").toBe("ida_existing");
  });

  it("stops routing a removed provider once invalidated", async () => {
    const fakes = withAccount(newFakes([provider()]));
    const verifier = verifierOf(fakes);
    expect((await verifier.verify(sign(CLAIMS)))?.identityId).toBe("ida_existing");

    fakes.providers.length = 0;
    verifier.invalidate();
    expect(await verifier.verify(sign(CLAIMS))).toBeNull();
  });

  it("reads the providers once per TTL, however many tokens it verifies", async () => {
    const now = Date.now();
    const fakes = withAccount(newFakes([provider()]));
    const verifier = verifierOf(fakes, { nowMs: () => now });
    for (let i = 0; i < 3; i += 1) {
      expect((await verifier.verify(sign(CLAIMS)))?.identityId).toBe("ida_existing");
    }
    expect(fakes.providerReads).toBe(1);
  });
});

describe("a provider its organization no longer owns", () => {
  const token = (): string => sign(CLAIMS);

  it("routes nothing, and is logged, when its organization is gone", async () => {
    const fakes = newFakes([provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_existing" } }),
    );
    const warnings: string[] = [];
    const verifier = verifierOf(fakes, { warnings, organizations: new Map() });

    expect(await verifier.verify(token())).toBeNull();
    expect(warnings).toContain(
      "federation issuer's organization is gone or younger than it; it routes no token",
    );
    expect(fakes.grants).toEqual([]);
  });

  it("routes nothing when its organization was created after it (the slug was freed and taken again)", async () => {
    const fakes = newFakes([provider({ createAccounts: true, signInRole: IamRole.viewer })]);
    const warnings: string[] = [];
    const verifier = verifierOf(fakes, {
      warnings,
      organizations: new Map([["acme", new Date("2026-09-20T00:00:00Z")]]),
    });

    expect(await verifier.verify(token())).toBeNull();
    expect(fakes.created).toEqual([]);
    expect(fakes.grants).toEqual([]);
  });

  it("still routes the organization's own provider beside it", async () => {
    const orphan = provider({
      audience: "https://api.gone.test/stigmer",
      metadata: { id: "fis_gone", org: "gone", slug: "gone-sso" },
    });
    const fakes = newFakes([orphan, provider()]);
    fakes.accountsByNaturalKey.set(
      "fis_1:okta|user-1",
      create(IdentityAccountSchema, { metadata: { id: "ida_existing" } }),
    );
    const verifier = verifierOf(fakes, { organizations: new Map([["acme", ORG_CREATED]]) });

    expect((await verifier.verify(token()))?.identityId).toBe("ida_existing");
    expect(
      await verifier.verify(sign({ ...CLAIMS, aud: "https://api.gone.test/stigmer" })),
    ).toBeNull();
  });
});
