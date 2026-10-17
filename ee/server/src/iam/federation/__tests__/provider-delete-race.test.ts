/**
 * The race between a provider's delete and a first sign-in through it,
 * made deterministic: the real removal (provider/removal.ts) and the real
 * federated verifier, over the in-memory provider store and one shared
 * world of accounts, grants and first-sign-in records, so each side sees
 * exactly what the other wrote.
 *
 * Why it needs its own suite: either side alone is correct by its own
 * unit tests, and the hole was in how they interleave. A first sign-in
 * creates its account and grants its role from a routing cache that may
 * predate the delete; a delete that listed the provider's accounts before
 * that account existed would leave it standing, with its role and any API
 * key it minted. The removal marks the provider first, and a sign-in that
 * wrote re-reads it, so at least one side sees the other.
 *
 * What the cases pin:
 *   - a sign-in held at its account's creation until the delete has listed
 *     the provider's accounts, the delete then held until the sign-in
 *     settles: the sign-in is refused, and no account, grant or
 *     first-sign-in record outlives the delete;
 *   - a sign-in that completed before the delete began leaves an account
 *     the delete's sweep then removes, with its grant.
 */
import { createSign, generateKeyPairSync } from "node:crypto";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { ApiResourceRef, GrantSpec } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";

import { SILENT_LOGGER } from "../../../__test-utils__/refusing-doubles.js";
import { newJwksKeyCache } from "../../../verifiers/jwks.js";
import type { IdentityAccountService, NewAccountRequest } from "../../account/port.js";
import type { OrganizationLookup } from "../../organization-links.js";
import type { GrantPathClient } from "../../grant/grant-path-client.js";
import { newIssuerRemoval } from "../../issuer/removal.js";
import { InMemoryIssuerStore, storedIssuer } from "../../issuer/__tests__/in-memory-issuer-store.js";
import { newStoreBackedFederatedVerifier } from "../verifier.js";
import { inMemorySignInGrants } from "./in-memory-sign-in-grants.js";
import { inMemoryNames } from "../../../__test-utils__/in-memory-names.js";
import type { InMemoryNames } from "../../../__test-utils__/in-memory-names.js";

const idpKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ISSUER = "https://sso.race.test";
const AUDIENCE = "https://api.race.test/stigmer";
const ISSUER_ID = "fis_race";
const DELETER = "ida_deleter";

/** A compact RS256 JWT from the provider's federation issuer. */
function signed(sub: string): string {
  const head = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      sub,
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: `${sub}@race.test`,
    }),
  ).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${head}.${body}`);
  return `${head}.${body}.${signer.sign(idpKey.privateKey).toString("base64url")}`;
}

/** A promise with its resolver, for holding one side at a chosen point. */
function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** The two holds a case may place: before an account is created, and after the delete's listing. */
interface Holds {
  beforeCreate?: Promise<void>;
  onCreateReached?: () => void;
  afterListing?: Promise<void>;
  onListed?: () => void;
}

/**
 * One world both sides act on: accounts keyed by (provider id, sub), grants
 * by principal and resource, and the first-sign-in ledger.
 */
function world(holds: Holds = {}) {
  const providers = new InMemoryIssuerStore();
  const names = inMemoryNames();
  const accounts = new Map<string, { readonly key: string; readonly account: IdentityAccount }>();
  const grants: GrantSpec[] = [];
  const signInGrants = inMemorySignInGrants();
  let minted = 0;

  const byKey = (key: string): IdentityAccount | undefined =>
    [...accounts.values()].find((held) => held.key === key)?.account;
  const dropGrantsOf = (id: string): void => {
    for (let at = grants.length - 1; at >= 0; at -= 1) {
      if (grants[at]?.principal?.id === id || grants[at]?.resource?.id === id) {
        grants.splice(at, 1);
      }
    }
  };

  const accountService = {
    store: {
      findByIssuerAndIdpId: (providerId: string, sub: string) =>
        Promise.resolve(byKey(`${providerId}:${sub}`)),
      findByIssuer: async (providerId: string) => {
        const listed = [...accounts.values()]
          .filter((held) => held.key.startsWith(`${providerId}:`))
          .map((held) => held.account);
        holds.onListed?.();
        await holds.afterListing;
        return listed;
      },
      deleteById: (id: string) => {
        accounts.delete(id);
        return Promise.resolve();
      },
    },
    createAccount: async (request: NewAccountRequest) => {
      holds.onCreateReached?.();
      await holds.beforeCreate;
      minted += 1;
      const id = `ida_signed_in_${minted}`;
      const ref = request.spec.federationIssuerRef;
      const account = create(IdentityAccountSchema, { metadata: { id } });
      accounts.set(id, { key: `${ref?.id ?? ""}:${request.spec.idpId}`, account });
      return account;
    },
    deleteAccount: (account: IdentityAccount) => {
      const id = account.metadata?.id ?? "";
      dropGrantsOf(id);
      accounts.delete(id);
      return Promise.resolve();
    },
  } as unknown as IdentityAccountService;

  const grantPath = {
    create: (spec: GrantSpec) => {
      grants.push(spec);
      return Promise.resolve(undefined as never);
    },
    delete: (spec: GrantSpec) => {
      const at = grants.findIndex(
        (held) => held.principal?.id === spec.principal?.id && held.resource?.id === spec.resource?.id,
      );
      if (at >= 0) {
        grants.splice(at, 1);
      }
      return Promise.resolve(undefined as never);
    },
    cleanupResourceGrants: (ref: ApiResourceRef) => {
      dropGrantsOf(ref.id);
      return Promise.resolve();
    },
  } as unknown as GrantPathClient;

  const organizations: OrganizationLookup = {
    find: () =>
      Promise.resolve({
        createdAt: new Date("2026-09-01T00:00:00Z"),
        name: "acme",
        slug: "acme",
        logoUrl: "",
        parentOrg: "",
      }),
  };

  const jwk = idpKey.publicKey.export({ format: "jwk" });
  const verifier = newStoreBackedFederatedVerifier({
    providers,
    accounts: accountService,
    grants: grantPath,
    childOrganizations: { findByExternalId: () => Promise.resolve(undefined) },
    signInGrants,
    fetchUserProfile: () => Promise.reject(new Error("no userinfo in this suite")),
    logger: SILENT_LOGGER,
    jwks: newJwksKeyCache({
      fetchImpl: () => Promise.resolve(new Response(JSON.stringify({ keys: [{ ...jwk, kid: "k1" }] }))),
      logger: SILENT_LOGGER,
    }),
    reservedIssuers: [],
    organizations,
  });
  const removal = newIssuerRemoval({
    providers,
    names,
    accounts: accountService,
    grants: grantPath,
    invalidate: () => verifier.invalidate(),
    logger: SILENT_LOGGER,
  });

  return { providers, names, accounts, grants, signInGrants, verifier, removal };
}

/** The provider under delete: it creates accounts on sign-in and grants viewer. */
async function seedIssuer(providers: InMemoryIssuerStore, names: InMemoryNames): Promise<void> {
  const provider = storedIssuer({
    id: ISSUER_ID,
    org: "acme",
    slug: "acme-sso",
    issuers: [ISSUER],
    expectedAudience: AUDIENCE,
    createdAt: new Date("2026-09-10T00:00:00Z"),
  });
  if (provider.spec !== undefined) {
    provider.spec.jwksUri = `${ISSUER}/jwks`;
    provider.spec.createAccountsOnSignIn = true;
    provider.spec.signInRole = IamRole.viewer;
  }
  await providers.insert(provider);
  await names.resourceNames.claim(
    { kind: "federation_issuer", org: "acme", name: "acme-sso" },
    ISSUER_ID,
    "2026-09-10T00:00:00.000Z",
  );
}

describe("a provider's delete racing a first sign-in through it", () => {
  it("refuses a sign-in that creates its account after the delete listed the provider's accounts, and leaves nothing", async () => {
    const createReached = deferred();
    const listed = deferred();
    const signInSettled = deferred();
    const w = world({
      onCreateReached: createReached.resolve,
      beforeCreate: listed.promise,
      onListed: listed.resolve,
      afterListing: signInSettled.promise,
    });
    await seedIssuer(w.providers, w.names);

    const signIn = w.verifier.verify(signed("okta|late")).then(
      () => undefined,
      (error: unknown) => error,
    );
    void signIn.finally(signInSettled.resolve);
    await createReached.promise;
    const deleted = w.removal.remove(ISSUER_ID, DELETER);

    const refused = await signIn;
    await deleted;
    expect(refused).toBeInstanceOf(ConnectError);
    expect((refused as ConnectError).code).toBe(Code.Unauthenticated);
    expect([...w.accounts.keys()], "no account the federation issuer made survives").toEqual([]);
    expect(w.grants, "and no role").toEqual([]);
    expect(w.signInGrants.rows.size, "and no first-sign-in record").toBe(0);
    expect(await w.providers.findById(ISSUER_ID)).toBeUndefined();
  });

  it("removes, with its grant, the account of a sign-in that finished before the delete began", async () => {
    const w = world();
    await seedIssuer(w.providers, w.names);

    const identity = await w.verifier.verify(signed("okta|early"));
    expect(identity?.identityId).toBe("ida_signed_in_1");
    expect(w.grants.map((grant) => [grant.relation, grant.principal?.id])).toEqual([["viewer", "ida_signed_in_1"]]);

    await w.removal.remove(ISSUER_ID, DELETER);
    expect([...w.accounts.keys()]).toEqual([]);
    expect(w.grants).toEqual([]);
  });
});
