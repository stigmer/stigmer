/**
 * The IdentityAccountStore PORT-CONTRACT KIT: every behavior an implementation of
 * store.ts must satisfy
 * identically, as cases a driver's test iterates. Open source runs them
 * over its own adapter (resource-store.ts) on sqlite and Postgres in
 * __tests__/resource-store.postgres.test.ts; a composition runs the SAME cases over
 * the store it registers as `drivers.identityAccountStore` (the cloud's
 * `cloud.iam_identity_account` store), so "the port holds" is one
 * statement proven per driver, never restated per repository.
 *
 * Shape. The kit is a list of declarations over the port-contract runner
 * (store/port-contract.ts, lifted from this file when the IamPolicy kit
 * became the second): the runner owns the fresh
 * fixture per case, the cleanup, the rule that a failing assertion wins
 * over a failing cleanup, and the reason the kit returns cases instead of
 * calling vitest's `describe`. `disconnect` is the one escape hatch: the
 * port has no lifecycle by design (a composition owns its store's), yet
 * "an outage never reads as no account" is the line that matters most, so
 * the fixture cuts the store from its database and the kit asserts that
 * the fault propagates instead of reading as `undefined`.
 *
 * What the kit deliberately does not carry: open source's primary-key read
 * (the findByField spy) and its derived-id refusals, the cloud's column
 * layout and SQLSTATE 23505 mapping — driver-physical, each driver's own
 * tests. Every fixture row sits at the address open source derives for it
 * (constants.ts: `accountIdFor` of a direct subject, `federatedAccountIdFor`
 * of a federated provider and subject), so one case list runs over an
 * adapter that refuses any other id and over a driver that keeps whatever
 * id it is given. On open source a federated row's address and its
 * subject's direct address differ, so a direct lookup cannot reach it by
 * id; the cases still hold every driver to the line, and the OSS adapter
 * keeps its mode filter for a lookup handed the federated text itself.
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

import { portContractCases } from "../../store/port-contract.js";
import type {
  PortContractCase,
  PortContractDeclaration,
  PortContractFixture,
} from "../../store/port-contract.js";
import { accountIdFor, federatedAccountIdFor } from "./constants.js";
import { DuplicateAccountError } from "./store.js";
import type { IdentityAccountStore } from "./store.js";

/** The runner's fixture over this port — the name a driver's test and the barrel know it by. */
export type IdentityAccountStoreContractFixture =
  PortContractFixture<IdentityAccountStore>;

export type IdentityAccountStoreContractCase = PortContractCase;

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

/** An identity provider as a stored reference names it: its organization's id and its slug. */
interface ProviderRef {
  readonly org: string;
  readonly slug: string;
}

const ACME_ORG = "org_01hzacme000000000000000000";
const BETA_ORG = "org_01hzbeta000000000000000000";
const ACME_OKTA: ProviderRef = { org: ACME_ORG, slug: "acme-okta" };
const ACME_AZURE: ProviderRef = { org: ACME_ORG, slug: "acme-azure" };

/**
 * A federated account: a customer IdP's subject, marked by its
 * identity_provider_ref and mode, at the address of its provider and
 * subject, in the provider's organization.
 */
function federatedAccount(overrides: {
  idpId: string;
  email?: string;
  provider?: ProviderRef;
}): IdentityAccount {
  const provider = overrides.provider ?? ACME_OKTA;
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: {
      id: federatedAccountIdFor(provider.org, provider.slug, overrides.idpId),
      name: overrides.email ?? overrides.idpId,
      org: provider.org,
    },
    spec: {
      idpId: overrides.idpId,
      email: overrides.email ?? "",
      provisioningMode: IdentityAccountProvisioningMode.federated,
      identityProviderRef: {
        org: provider.org,
        kind: ApiResourceKind.identity_provider,
        slug: provider.slug,
      },
    },
  });
}

/**
 * A platform-client end user as the mint provisions it: the reserved
 * composite subject, mode `platform_client`, the owning organization, and
 * the derived id of its subject (the id every subject lookup reads).
 */
function platformClientAccount(overrides: {
  idpId: string;
  email: string;
  org?: string;
}): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: {
      id: accountIdFor(overrides.idpId),
      name: overrides.email,
      org: overrides.org ?? "acme",
    },
    spec: {
      idpId: overrides.idpId,
      email: overrides.email,
      provisioningMode: IdentityAccountProvisioningMode.platform_client,
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

/**
 * The two shapes the port refuses, under one subject's derived id: a
 * provider ref with no mode (the row that split a person's sign-in), and
 * mode `federated` with no provider ref. Each is labelled for the
 * assertion that names it.
 */
function mixedShapeAccounts(idpId: string): ReadonlyArray<{
  readonly shape: string;
  readonly account: IdentityAccount;
}> {
  const id = accountIdFor(idpId);
  return [
    {
      shape: "a provider ref with no mode",
      account: create(IdentityAccountSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityAccount",
        metadata: { id, name: idpId },
        spec: {
          idpId,
          identityProviderRef: {
            org: ACME_ORG,
            kind: ApiResourceKind.identity_provider,
            slug: "acme-okta",
          },
        },
      }),
    },
    {
      shape: "mode federated with no provider ref",
      account: create(IdentityAccountSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityAccount",
        metadata: { id, name: idpId },
        spec: {
          idpId,
          provisioningMode: IdentityAccountProvisioningMode.federated,
        },
      }),
    },
  ];
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

const CASES: ReadonlyArray<PortContractDeclaration<IdentityAccountStore>> = [
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
    "no subject lookup answers a federated account: its subject is its identity provider's",
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
        await store.findByIdpId("auth0|fed"),
        undefined,
        "the subject lookup must not resolve to a federated account: a provider chooses its subjects, so one equal to a platform person's or a platform client user's would otherwise answer for them",
      );
    },
  ],
  [
    "findByProviderAndIdpId finds a federated row by its provider and subject, and nothing under another provider or subject",
    async ({ store }) => {
      const dana = federatedAccount({ idpId: "okta|dana" });
      await store.save(dana);
      assert.equal(
        (await store.findByProviderAndIdpId(ACME_ORG, "acme-okta", "okta|dana"))
          ?.metadata?.id,
        idOf(dana),
        "the natural key must find the row it names",
      );
      assert.equal(
        await store.findByProviderAndIdpId(ACME_ORG, "acme-azure", "okta|dana"),
        undefined,
        "another provider's subject is another person",
      );
      assert.equal(
        await store.findByProviderAndIdpId(BETA_ORG, "acme-okta", "okta|dana"),
        undefined,
        "a provider slug in another organization is another provider",
      );
      assert.equal(
        await store.findByProviderAndIdpId(ACME_ORG, "acme-okta", "okta|erin"),
        undefined,
        "an unknown subject answers undefined",
      );
    },
  ],
  [
    "findByProviderAndIdpId keeps two providers' same subject apart, and never answers a direct row sharing the subject",
    async ({ store }) => {
      await store.save(directAccount({ idpId: "shared|sam" }));
      assert.equal(
        await store.findByProviderAndIdpId(ACME_ORG, "acme-okta", "shared|sam"),
        undefined,
        "a provider's lookup never answers a direct row that shares the subject",
      );
      const viaOkta = federatedAccount({ idpId: "shared|sam", provider: ACME_OKTA });
      const viaAzure = federatedAccount({ idpId: "shared|sam", provider: ACME_AZURE });
      await store.save(viaOkta);
      await store.save(viaAzure);
      assert.equal(
        (await store.findByProviderAndIdpId(ACME_ORG, "acme-okta", "shared|sam"))
          ?.metadata?.id,
        idOf(viaOkta),
      );
      assert.equal(
        (await store.findByProviderAndIdpId(ACME_ORG, "acme-azure", "shared|sam"))
          ?.metadata?.id,
        idOf(viaAzure),
      );
      assert.equal(
        (await store.findDirectByIdpId("shared|sam"))?.metadata?.id,
        accountIdFor("shared|sam"),
        "the direct row keeps answering its own subject beside two federated rows that share it",
      );
    },
  ],
  [
    "findByProvider answers every row the provider vouches for, in id order, and none of another provider's or a direct row",
    async ({ store }) => {
      const okta = [
        federatedAccount({ idpId: "okta|b" }),
        federatedAccount({ idpId: "okta|a" }),
        federatedAccount({ idpId: "okta|c" }),
      ];
      for (const account of okta) {
        await store.save(account);
      }
      await store.save(federatedAccount({ idpId: "azure|c", provider: ACME_AZURE }));
      await store.save(directAccount({ idpId: "okta|d" }));
      assert.deepEqual(
        (await store.findByProvider(ACME_ORG, "acme-okta")).map(
          (row) => row.metadata?.id,
        ),
        okta.map(idOf).sort(),
        "every row the provider vouches for, ordered by id",
      );
      assert.deepEqual(
        await store.findByProvider(BETA_ORG, "acme-okta"),
        [],
        "a provider slug in another organization is another provider",
      );
    },
  ],
  [
    "an outage is a fault on both federated reads, never 'no account'",
    async ({ store, disconnect }) => {
      await disconnect();
      await assert.rejects(
        store.findByProviderAndIdpId(ACME_ORG, "acme-okta", "okta|dana"),
        "a federated sign-in that read undefined from a broken store would provision a second account",
      );
      await assert.rejects(
        store.findByProvider(ACME_ORG, "acme-okta"),
        "a provider's removal that read nothing from a broken store would leave its accounts behind",
      );
    },
  ],
  [
    "findDirectByIdpId and findDirectByEmail never answer a platform-client account, while findByIdpId (any mode) does",
    async ({ store }) => {
      await store.save(
        platformClientAccount({
          idpId: "stgm_pc|acme|user-7",
          email: "pat@example.com",
        }),
      );
      assert.equal(
        await store.findDirectByIdpId("stgm_pc|acme|user-7"),
        undefined,
        "the direct-subject lookup must not resolve to an account a platform client provisioned",
      );
      assert.equal(
        await store.findDirectByEmail("pat@example.com"),
        undefined,
        "the direct-email lookup must not answer an email a platform asserted",
      );
      assert.equal(
        (await store.findByIdpId("stgm_pc|acme|user-7"))?.spec?.provisioningMode,
        IdentityAccountProvisioningMode.platform_client,
        "the any-mode subject lookup — the mint's — must answer the platform-client account",
      );
    },
  ],
  [
    "findByOrg answers the accounts whose row names the organization, and never a person's own",
    async ({ store }) => {
      await store.save(
        platformClientAccount({ idpId: "stgm_pc|acme|user-1", email: "a@example.com" }),
      );
      await store.save(
        platformClientAccount({ idpId: "stgm_pc|acme|user-2", email: "b@example.com" }),
      );
      await store.save(
        platformClientAccount({
          idpId: "stgm_pc|globex|user-1",
          email: "c@example.com",
          org: "globex",
        }),
      );
      await store.save(directAccount({ idpId: "auth0|person" }));
      assert.deepEqual(
        subjectsOf(await store.findByOrg("acme")).sort(),
        ["stgm_pc|acme|user-1", "stgm_pc|acme|user-2"],
        "the organization's own accounts, and no other organization's or person's",
      );
      assert.deepEqual(await store.findByOrg(""), [], "an empty organization names nothing");
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
  [
    "save and update refuse an account whose provider ref and federated mode disagree; a row with neither saves",
    async ({ store }) => {
      for (const { shape, account } of mixedShapeAccounts("auth0|mixed")) {
        await assert.rejects(
          store.save(account),
          `save must refuse ${shape}: every lookup reads "federated" from these two fields`,
        );
        assert.equal(
          await store.findById(idOf(account)),
          undefined,
          `a refused save of ${shape} must leave no row`,
        );
      }

      const standing = directAccount({ idpId: "auth0|mixed" });
      await store.save(standing);
      for (const { shape, account } of mixedShapeAccounts("auth0|mixed")) {
        await assert.rejects(
          store.update(account),
          `update must refuse turning a stored account into ${shape}`,
        );
      }
      const after = await store.findById(idOf(standing));
      assert.equal(
        after?.spec?.provisioningMode,
        IdentityAccountProvisioningMode.direct,
        "a refused update must leave the stored row's mode as it was",
      );
      assert.equal(
        after?.spec?.identityProviderRef,
        undefined,
        "a refused update must leave the stored row with no provider ref",
      );

      const unmarked = create(IdentityAccountSchema, {
        apiVersion: "iam.stigmer.ai/v1",
        kind: "IdentityAccount",
        metadata: { id: accountIdFor("stgm_guest|acme"), name: "system-guest" },
        spec: { idpId: "stgm_guest|acme" },
      });
      await store.save(unmarked);
      assert.equal(
        (await store.findDirectByIdpId("stgm_guest|acme"))?.metadata?.id,
        idOf(unmarked),
        "a row with neither a provider ref nor a mode (a composition's system account) must save and read as direct",
      );
    },
  ],
];

/** The port's cases over `makeFixture`, one fresh fixture per case. */
export function identityAccountStoreContract(
  makeFixture: () => Promise<IdentityAccountStoreContractFixture>,
): ReadonlyArray<IdentityAccountStoreContractCase> {
  return portContractCases(CASES, makeFixture);
}
