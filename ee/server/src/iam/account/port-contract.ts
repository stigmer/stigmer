/**
 * The contract kit of the account service the identity lanes depend on
 * (port.ts): what every host's `IdentityAccountService` does, whatever it
 * is built over, as cases a host's tests iterate. The lines:
 *   - `createAccount` makes a federated account its provider vouches for,
 *     found afterwards by its natural key;
 *   - a second create of a held account throws `DuplicateAccountError`,
 *     the error every lane's race arm resolves by, however the host's
 *     create path reports a duplicate;
 *   - `updateAccount` writes the profile as given, email included;
 *   - `deleteAccount` removes the account's keys, every policy row naming
 *     it and its row, so an account made again under the same id finds
 *     nothing of the old one alive; deleting an account that is already
 *     gone resolves;
 *   - two providers in one organization keep one subject apart: each
 *     account is found by its own provider's natural key, and a subject one
 *     provider vouches for is unknown to the other (a person signing in
 *     through one provider is never matched to another's account);
 *   - the store lists a provider's accounts in id order, every account made
 *     under it and none another provider vouches for (what the provider's
 *     removal deletes).
 * A host answers the probes the cases read (its keys, its policy rows)
 * from its own stores, through the fixture. The cases read accounts back
 * through `service.store`, so the provider lines hold over whichever store
 * the host composes, and they make every row through the host's own create
 * path, so each row sits at the id that host's store derives or keeps. The
 * store's own lines, over a host's store driver, are the library's
 * exported kit (`identityAccountStoreContract` in `@stigmer/server`).
 *
 * Shape: the library's kits' (`store/port-contract.ts` in `@stigmer/server`),
 * over its exported runner, so a failing assertion wins over a failing
 * cleanup. A host's fixture need not reset its store between cases: each
 * case uses subjects no other case does and asserts only the rows it made.
 * The kit asserts through node:assert and imports no test framework, so it
 * can ship with the code it describes.
 */
import assert from "node:assert/strict";

import { create } from "@bufbuild/protobuf";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IdentityAccountSpecSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/spec_pb";
import {
  DuplicateAccountError,
  portContractCases,
  type PortContractCase,
  type PortContractDeclaration,
  type PortContractFixture,
} from "@stigmer/server";

import type { IdentityAccountService, NewAccountRequest } from "./port.js";

/** What a service case drives: the service, two providers it may create under, and the host's probes. */
export interface IdentityAccountServiceUnderTest {
  readonly service: IdentityAccountService;
  /** A federation issuer the host holds: its organization, slug and id (the id is who a create acts for). */
  readonly provider: { readonly org: string; readonly slug: string; readonly id: string };
  /** A second federation issuer in the same organization; a create may act for it too. */
  readonly otherIssuer: { readonly org: string; readonly slug: string; readonly id: string };
  /** Gives the account one live key, through the host's own key lane. */
  issueKey(account: IdentityAccount): Promise<void>;
  /** How many live keys speak for the account. */
  keysOf(accountId: string): Promise<number>;
  /** How many policy rows name the account, as principal or as resource. */
  policyRowsNaming(accountId: string): Promise<number>;
}

/** The runner's fixture over a service. */
export type IdentityAccountServiceContractFixture = PortContractFixture<IdentityAccountServiceUnderTest>;

/** A federated person's account request under one of the fixture's providers. */
function federatedRequest(
  provider: IdentityAccountServiceUnderTest["provider"],
  subject: string,
  email: string,
): NewAccountRequest {
  return {
    org: provider.org,
    name: email,
    spec: create(IdentityAccountSpecSchema, {
      idpId: subject,
      email,
      firstName: "Dana",
      lastName: "Reyes",
      provisioningMode: IdentityAccountProvisioningMode.federated,
      federationIssuerRef: { org: provider.org, kind: ApiResourceKind.federation_issuer, id: provider.id },
    }),
  };
}

const SERVICE_CASES: ReadonlyArray<PortContractDeclaration<IdentityAccountServiceUnderTest>> = [
  [
    "createAccount makes a federated account its provider vouches for, found by its natural key",
    async ({ store: host }) => {
      const { provider, service } = host;
      const created = await service.createAccount(
        federatedRequest(provider, "okta|dana", "dana@acme.example"),
        provider.id,
      );
      const id = created.metadata?.id ?? "";
      assert.notEqual(id, "", "a created account carries its id");
      const found = await service.store.findByIssuerAndIdpId(provider.id, "okta|dana");
      assert.equal(found?.metadata?.id, id, "the natural key finds the account create made");
      assert.equal(found?.spec?.provisioningMode, IdentityAccountProvisioningMode.federated);
    },
  ],
  [
    "a second create of a held account throws DuplicateAccountError",
    async ({ store: host }) => {
      const { provider, service } = host;
      await service.createAccount(federatedRequest(provider, "okta|erin", "erin@acme.example"), provider.id);
      await assert.rejects(
        service.createAccount(federatedRequest(provider, "okta|erin", "erin@acme.example"), provider.id),
        (error: unknown) => error instanceof DuplicateAccountError,
        "a lost race reads as DuplicateAccountError, which every lane's race arm resolves by",
      );
    },
  ],
  [
    "updateAccount applies the change to the stored account and writes it, email included",
    async ({ store: host }) => {
      const { provider, service } = host;
      const created = await service.createAccount(
        federatedRequest(provider, "okta|fay", "fay@acme.example"),
        provider.id,
      );
      const updated = await service.updateAccount(created.metadata?.id ?? "", (account) => {
        assert.ok(account.spec !== undefined, "a stored account carries its spec");
        account.spec.email = "fay.reyes@acme.example";
        account.spec.lastName = "Reyes-Ortiz";
      });
      assert.equal(updated?.spec?.email, "fay.reyes@acme.example", "the written account is answered");
      const stored = await service.store.findById(created.metadata?.id ?? "");
      assert.equal(stored?.spec?.email, "fay.reyes@acme.example", "a changed email at the provider reaches the account");
      assert.equal(stored?.spec?.lastName, "Reyes-Ortiz");
    },
  ],
  [
    "deleteAccount removes the account's keys, every policy row naming it and its row",
    async ({ store: host }) => {
      const { provider, service } = host;
      const created = await service.createAccount(
        federatedRequest(provider, "okta|gus", "gus@acme.example"),
        provider.id,
      );
      const id = created.metadata?.id ?? "";
      await host.issueKey(created);
      assert.equal(await host.keysOf(id), 1, "the fixture's key speaks for the account");
      await service.deleteAccount(created, provider.id);
      assert.equal(await service.store.findById(id), undefined, "the row is gone");
      assert.equal(await host.keysOf(id), 0, "no key outlives its account");
      assert.equal(await host.policyRowsNaming(id), 0, "no policy row names a deleted account");
    },
  ],
  [
    "deleting an account that is already gone resolves",
    async ({ store: host }) => {
      const { provider, service } = host;
      const created = await service.createAccount(
        federatedRequest(provider, "okta|hal", "hal@acme.example"),
        provider.id,
      );
      await service.deleteAccount(created, provider.id);
      await service.deleteAccount(created, provider.id);
      assert.equal(await service.store.findById(created.metadata?.id ?? ""), undefined);
    },
  ],
  [
    "createAccount under two providers keeps one subject apart: each account is found by its own provider's natural key, and a subject one provider vouches for is unknown to the other",
    async ({ store: host }) => {
      const { provider, otherIssuer, service } = host;
      const first = await service.createAccount(
        federatedRequest(provider, "okta|ivy", "ivy@acme.example"),
        provider.id,
      );
      const second = await service.createAccount(
        federatedRequest(otherIssuer, "okta|ivy", "ivy.other@acme.example"),
        otherIssuer.id,
      );
      await service.createAccount(federatedRequest(provider, "okta|jo", "jo@acme.example"), provider.id);
      const firstId = first.metadata?.id ?? "";
      const secondId = second.metadata?.id ?? "";
      assert.notEqual(firstId, secondId, "one subject under two providers is two people");
      assert.equal(
        (await service.store.findByIssuerAndIdpId(provider.id, "okta|ivy"))?.metadata?.id,
        firstId,
        "the natural key finds the account its own provider vouches for",
      );
      assert.equal(
        (await service.store.findByIssuerAndIdpId(otherIssuer.id, "okta|ivy"))?.metadata?.id,
        secondId,
        "the other provider's natural key finds its own account, never the first",
      );
      assert.equal(
        await service.store.findByIssuerAndIdpId(otherIssuer.id, "okta|jo"),
        undefined,
        "a subject only one provider vouches for is unknown to the other",
      );
    },
  ],
  [
    "the store lists a provider's accounts in id order: every account createAccount made under it, and none another provider vouches for",
    async ({ store: host }) => {
      const { provider, otherIssuer, service } = host;
      const kai = await service.createAccount(federatedRequest(provider, "okta|kai", "kai@acme.example"), provider.id);
      const lee = await service.createAccount(federatedRequest(provider, "okta|lee", "lee@acme.example"), provider.id);
      const mo = await service.createAccount(
        federatedRequest(otherIssuer, "okta|mo", "mo@acme.example"),
        otherIssuer.id,
      );
      const [kaiId, leeId, moId] = [kai, lee, mo].map((created) => created.metadata?.id ?? "");

      const listed = await service.store.findByIssuer(provider.id);
      const ids = listed.map((row) => row.metadata?.id ?? "");
      assert.ok(ids.includes(kaiId) && ids.includes(leeId), "every account made under the provider is listed");
      assert.ok(!ids.includes(moId), "an account another provider vouches for is never listed");
      for (const row of listed) {
        assert.equal(row.spec?.federationIssuerRef?.id, provider.id, "every listed account names the provider");
      }
      assert.deepEqual(ids, [...ids].sort(), "the provider's accounts come in id order");

      const otherIds = (await service.store.findByIssuer(otherIssuer.id)).map((row) => row.metadata?.id ?? "");
      assert.ok(otherIds.includes(moId), "the other provider lists its own account");
      assert.ok(!otherIds.includes(kaiId) && !otherIds.includes(leeId), "and none the first provider vouches for");
    },
  ],
];

/** The service's cases over `makeFixture`, one fresh fixture per case. */
export function identityAccountServiceContract(
  makeFixture: () => Promise<IdentityAccountServiceContractFixture>,
): ReadonlyArray<PortContractCase> {
  return portContractCases(SERVICE_CASES, makeFixture);
}
