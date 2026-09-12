/**
 * The IdentityAccountStore PORT-CONTRACT KIT (20260911.11, T01_1_review.md
 * A11 and A12): every behavior an implementation of store.ts must satisfy
 * identically, as cases a driver's test iterates. Open source runs them
 * over its own adapter (resource-store.ts) on sqlite and Postgres in
 * __tests__/resource-store.test.ts; a composition runs the SAME cases over
 * the store it registers as `drivers.identityAccountStore` (the cloud's
 * `cloud.iam_identity_account` store), so "the port holds" is one
 * statement proven per driver, never restated per repository.
 *
 * Shape. The package's precedent is store/__tests__/store-contract.ts —
 * `describeStoreContract(makeFixture)`: a fresh fixture per test, named
 * escape hatches for the arms the interface cannot express, driver-physical
 * behavior left to each driver's own tests. This kit follows it in
 * everything but the framework: it is consumed by ANOTHER package's tests,
 * so it ships in dist/ and must not import vitest — a devDependency that
 * would enter the root barrel's runtime import graph. It therefore returns
 * cases instead of calling `describe`, asserts through node:assert/strict,
 * and the consumer's framework does `for (const c of cases) it(c.name,
 * c.run)`. Do not "fix" it back to the precedent's vitest shape.
 *
 * Every case makes a FRESH fixture, runs, and cleans up; a failing
 * assertion wins over a failing cleanup. `disconnect` is the one escape
 * hatch: the port has no lifecycle by design (a composition owns its
 * store's), yet "an outage never reads as no account" is the line that
 * matters most, so the fixture cuts the store from its database and the
 * kit asserts that the fault propagates instead of reading as `undefined`.
 *
 * What the kit deliberately does not carry: open source's primary-key read
 * (the findByField spy) and its derived-id refusal, the cloud's column
 * layout and SQLSTATE 23505 mapping — driver-physical, each driver's own
 * tests. Nor does any case hold a direct and a federated row under one
 * subject: open source has no federated writer and its derived-id key could
 * not hold both. The federated fixture carries the derived id of its
 * subject, so the OSS adapter's mode filter — not an unreachable id — is
 * what the direct-only arms exercise.
 *
 * The duplicate arm checks `instanceof DuplicateAccountError` on the
 * exported class, because that is how the domain's race arm (steps.ts)
 * catches it: a driver throwing a lookalike fails here for the reason it
 * would fail provisioning.
 *
 * Case names are the contract lines, in the port's words. The OSS test pins
 * the full list, so a case cannot drop out of the kit unnoticed.
 */
import assert from "node:assert/strict";

import { create, equals } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { accountIdFor } from "./constants.js";
import { DuplicateAccountError } from "./store.js";
import type { IdentityAccountStore } from "./store.js";

/** One fresh, isolated store per case, plus the one escape hatch the port cannot express. */
export interface IdentityAccountStoreContractFixture {
  readonly store: IdentityAccountStore;
  /**
   * Cuts the store from its database so every later call is an
   * infrastructure fault. `cleanup` still runs afterwards and must tolerate
   * a disconnected store (both OSS drivers' `close` is idempotent; a pool
   * fixture ends a per-case pool here and skips it in cleanup).
   */
  disconnect(): Promise<void>;
  cleanup(): Promise<void>;
}

export interface IdentityAccountStoreContractCase {
  /** The contract line, in the port's words; the framework prints it as the test name. */
  readonly name: string;
  /** Makes a FRESH fixture, runs the case, cleans up. A failing assertion wins over a failing cleanup. */
  run(): Promise<void>;
}

/** A case body over a live fixture; the kit owns the fixture's lifecycle around it. */
type CaseBody = (fixture: IdentityAccountStoreContractFixture) => Promise<void>;

/** A direct account as the domain writes it: id derived from the subject, mode direct. */
function directAccount(overrides: {
  idpId: string;
  email?: string;
  firstName?: string;
}): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: {
      id: accountIdFor(overrides.idpId),
      name: overrides.email ?? overrides.idpId,
    },
    spec: {
      idpId: overrides.idpId,
      email: overrides.email ?? "",
      firstName: overrides.firstName ?? "",
      provisioningMode: IdentityAccountProvisioningMode.direct,
    },
  });
}

/**
 * A federated account: a customer IdP's subject, marked by its
 * identity_provider_ref and mode. Its id is the derived id of its subject
 * (see the header: the mode filter, not the id, must be what excludes it).
 */
function federatedAccount(overrides: {
  idpId: string;
  email: string;
}): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: { id: accountIdFor(overrides.idpId), name: overrides.email },
    spec: {
      idpId: overrides.idpId,
      email: overrides.email,
      provisioningMode: IdentityAccountProvisioningMode.federated,
      identityProviderRef: {
        org: "acme",
        kind: ApiResourceKind.identity_provider,
        slug: "acme-okta",
      },
    },
  });
}

/** A direct account with no subject — the row no lookup could ever reach. */
function subjectlessDirectAccount(): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: { id: "ida_00000000000000000000000000", name: "subjectless" },
    spec: {
      idpId: "",
      provisioningMode: IdentityAccountProvisioningMode.direct,
    },
  });
}

/** The id of the account, asserted present so a message names the row, not `undefined`. */
function idOf(account: IdentityAccount): string {
  const id = account.metadata?.id ?? "";
  assert.notEqual(id, "", "a fixture account must carry an id");
  return id;
}

function subjectsOf(accounts: ReadonlyArray<IdentityAccount>): string[] {
  return accounts.map((account) => account.spec?.idpId ?? "");
}

const CASES: ReadonlyArray<readonly [string, CaseBody]> = [
  [
    "save then findById round-trips the account",
    async ({ store }) => {
      const account = directAccount({
        idpId: "auth0|alice",
        email: "alice@example.com",
      });
      await store.save(account);
      const found = await store.findById(idOf(account));
      assert.ok(found !== undefined, "a saved account must be readable by id");
      assert.ok(
        equals(IdentityAccountSchema, found, account),
        "findById must return the account exactly as it was saved",
      );
    },
  ],
  [
    "a second save under a held id is DuplicateAccountError, and the first row stands",
    async ({ store }) => {
      const first = directAccount({ idpId: "auth0|bob", firstName: "First" });
      const second = directAccount({
        idpId: "auth0|bob",
        firstName: "Second",
      });
      await store.save(first);
      await assert.rejects(
        store.save(second),
        DuplicateAccountError,
        "save under a held id must raise the exported DuplicateAccountError, never overwrite",
      );
      const standing = await store.findDirectByIdpId("auth0|bob");
      assert.equal(
        standing?.spec?.firstName,
        "First",
        "the first writer's row must stand after a refused duplicate",
      );
    },
  ],
  [
    "findDirectByIdpId answers a direct account by its subject and undefined for an unknown one",
    async ({ store }) => {
      await store.save(directAccount({ idpId: "auth0|carol" }));
      const hit = await store.findDirectByIdpId("auth0|carol");
      assert.equal(
        hit?.metadata?.id,
        accountIdFor("auth0|carol"),
        "the direct account for a subject must be found by that subject",
      );
      assert.equal(
        await store.findDirectByIdpId("auth0|nobody"),
        undefined,
        "an unknown subject must read as undefined, not as an error",
      );
    },
  ],
  [
    "findByIdpId (any mode) answers the same direct account",
    async ({ store }) => {
      await store.save(directAccount({ idpId: "auth0|dave" }));
      assert.equal(
        (await store.findByIdpId("auth0|dave"))?.spec?.idpId,
        "auth0|dave",
        "findByIdpId must answer a direct account by its subject",
      );
      assert.equal(
        await store.findByIdpId("auth0|nobody"),
        undefined,
        "an unknown subject must read as undefined on the any-mode lookup too",
      );
    },
  ],
  [
    "findDirectByEmail is an exact, case-sensitive match on direct accounts",
    async ({ store }) => {
      await store.save(
        directAccount({ idpId: "auth0|erin", email: "erin@example.com" }),
      );
      assert.equal(
        (await store.findDirectByEmail("erin@example.com"))?.spec?.idpId,
        "auth0|erin",
        "the direct account with an email must be found by that exact email",
      );
      assert.equal(
        await store.findDirectByEmail("ERIN@example.com"),
        undefined,
        "the email match is exact: a different case is a different string",
      );
      assert.equal(
        await store.findDirectByEmail("nobody@example.com"),
        undefined,
        "an unknown email must read as undefined",
      );
    },
  ],
  [
    "update replaces the row in place and keeps the id",
    async ({ store }) => {
      const account = directAccount({
        idpId: "auth0|frank",
        firstName: "Frank",
      });
      await store.save(account);
      await store.update(
        directAccount({ idpId: "auth0|frank", firstName: "Francis" }),
      );
      const updated = await store.findById(idOf(account));
      assert.equal(
        updated?.spec?.firstName,
        "Francis",
        "update must replace the stored row with the given one",
      );
      assert.equal(
        updated?.metadata?.id,
        idOf(account),
        "update must not move the row to another id",
      );
    },
  ],
  [
    "deleteById removes the row; the subject is free to be provisioned again",
    async ({ store }) => {
      const account = directAccount({ idpId: "auth0|grace" });
      await store.save(account);
      await store.deleteById(idOf(account));
      assert.equal(
        await store.findById(idOf(account)),
        undefined,
        "a deleted account must not be readable by id",
      );
      assert.equal(
        await store.findDirectByIdpId("auth0|grace"),
        undefined,
        "a deleted account must not be readable by subject",
      );
      await assert.doesNotReject(
        store.save(account),
        "the subject of a deleted account must be savable again",
      );
    },
  ],
  [
    "findByIds answers the present ones in request order and skips the unknown",
    async ({ store }) => {
      const heidi = directAccount({ idpId: "auth0|heidi" });
      const ivan = directAccount({ idpId: "auth0|ivan" });
      await store.save(heidi);
      await store.save(ivan);
      const found = await store.findByIds([
        idOf(ivan),
        "ida_00000000000000000000000000",
        idOf(heidi),
      ]);
      assert.deepEqual(
        subjectsOf(found),
        ["auth0|ivan", "auth0|heidi"],
        "findByIds must keep the request's order and skip ids that are not held",
      );
    },
  ],
  [
    "a disconnected store is an infrastructure fault, never 'not found'",
    async (fixture) => {
      await fixture.disconnect();
      await assert.rejects(
        fixture.store.findDirectByIdpId("auth0|anyone"),
        "a subject read on a disconnected store must reject, never read as undefined",
      );
      await assert.rejects(
        fixture.store.findById(accountIdFor("auth0|anyone")),
        "an id read on a disconnected store must reject, never read as undefined",
      );
    },
  ],
  [
    "two concurrent saves of one subject end in fulfilments and DuplicateAccountErrors only, and the winner is readable by subject",
    async ({ store }) => {
      const results = await Promise.allSettled([
        store.save(directAccount({ idpId: "auth0|race", firstName: "A" })),
        store.save(directAccount({ idpId: "auth0|race", firstName: "B" })),
      ]);
      for (const result of results) {
        if (result.status === "rejected") {
          assert.ok(
            result.reason instanceof DuplicateAccountError,
            `a losing concurrent save must fail as DuplicateAccountError, got ${String(result.reason)}`,
          );
        }
      }
      assert.ok(
        results.some((result) => result.status === "fulfilled"),
        "at least one of two concurrent saves must win",
      );
      const winner = await store.findDirectByIdpId("auth0|race");
      assert.equal(
        winner?.metadata?.id,
        accountIdFor("auth0|race"),
        "the winner must be readable by its subject",
      );
    },
  ],
  [
    "findDirectByIdpId and findDirectByEmail never answer a federated account, while findByIdpId (any mode) does",
    async ({ store }) => {
      await store.save(
        federatedAccount({ idpId: "auth0|fed", email: "fed@example.com" }),
      );
      assert.equal(
        await store.findDirectByIdpId("auth0|fed"),
        undefined,
        "the direct-subject lookup must not resolve to a federated account",
      );
      assert.equal(
        await store.findDirectByEmail("fed@example.com"),
        undefined,
        "the direct-email lookup must not resolve to a federated account",
      );
      assert.equal(
        (await store.findByIdpId("auth0|fed"))?.spec?.provisioningMode,
        IdentityAccountProvisioningMode.federated,
        "the any-mode subject lookup must answer the federated account",
      );
    },
  ],
  [
    "findByIds answers one row per distinct id, in first-occurrence order; an empty request answers an empty list",
    async ({ store }) => {
      const judy = directAccount({ idpId: "auth0|judy" });
      const kim = directAccount({ idpId: "auth0|kim" });
      await store.save(judy);
      await store.save(kim);
      assert.deepEqual(
        subjectsOf(
          await store.findByIds([idOf(kim), idOf(judy), idOf(kim), idOf(judy)]),
        ),
        ["auth0|kim", "auth0|judy"],
        "a repeated id must answer once, at its first position",
      );
      assert.deepEqual(
        await store.findByIds([]),
        [],
        "an empty request must answer an empty list, not a scan",
      );
    },
  ],
  [
    "update of an unknown id is a no-op: no row appears",
    async ({ store }) => {
      const ghost = directAccount({ idpId: "auth0|ghost" });
      await store.update(ghost);
      assert.equal(
        await store.findById(idOf(ghost)),
        undefined,
        "update must replace, never create: an unknown id must leave no row by id",
      );
      assert.equal(
        await store.findDirectByIdpId("auth0|ghost"),
        undefined,
        "update must replace, never create: an unknown id must leave no row by subject",
      );
    },
  ],
  [
    "deleteById of an unknown id resolves",
    async ({ store }) => {
      await assert.doesNotReject(
        store.deleteById(accountIdFor("auth0|nobody")),
        "deleting an id that is not held must resolve, not reject",
      );
    },
  ],
  [
    "save refuses a direct account with an empty idp_id",
    async ({ store }) => {
      await assert.rejects(
        store.save(subjectlessDirectAccount()),
        "a direct account with no subject has no principal and must be refused, never stored",
      );
    },
  ],
];

/**
 * Runs `body` over a fresh fixture. The body's failure is the one reported:
 * a cleanup failure after a failed body would otherwise replace the
 * assertion that matters with a teardown detail.
 */
async function withFixture(
  makeFixture: () => Promise<IdentityAccountStoreContractFixture>,
  body: CaseBody,
): Promise<void> {
  const fixture = await makeFixture();
  let failed = false;
  try {
    await body(fixture);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await fixture.cleanup();
    } catch (cleanupError) {
      if (!failed) {
        throw cleanupError;
      }
    }
  }
}

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function identityAccountStoreContract(
  makeFixture: () => Promise<IdentityAccountStoreContractFixture>,
): ReadonlyArray<IdentityAccountStoreContractCase> {
  return CASES.map(([name, body]) => ({
    name,
    run: () => withFixture(makeFixture, body),
  }));
}
