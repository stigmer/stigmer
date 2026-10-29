/**
 * The open-source IdentityAccountStore: the port (store.ts) over the
 * generic Store, rows of the `resources` table by kind. The composition
 * root installs it when no
 * extension registers `drivers.identityAccountStore`.
 *
 * Every subject lookup is a PRIMARY-KEY read of the derived id
 * (constants.ts accountIdFor): open source never mints a random account
 * id, so "the account with subject S" IS "the row with id accountIdFor(S)". That
 * is what makes the OIDC lane's per-request resolve, whoAmI and the
 * provisioning idempotency check O(1) reads with no secondary index and
 * no scan, and it is why `save` refuses a direct account whose id is not
 * its derived id — a stray row would be unreachable by subject forever.
 * A federated account is addressed the same way by its own natural key:
 * its id is `federatedAccountIdFor(provider id, subject)`,
 * so the federated sign-in's lookup is one primary-key read too, and
 * `save` refuses a federated account whose id is not that address. The
 * reserved `stgm_fed|` text keeps the two address spaces apart
 * (constants.ts). The rule is this adapter's own, not the port's: an
 * edition with its own table keys federated rows by an index and keeps
 * the ids it minted.
 * `findDirectByEmail` and `findByIssuer` are the lookups that scan
 * (Store.findAllByField, a decode-and-scan of the kind's rows): an
 * administrative RPC and a provider's removal, never a per-request path.
 * The email scan reads every row with the email and answers the direct
 * one, because the email axis is shared: a federated or app-user row may
 * carry a direct person's email, and a first-match read would
 * answer that row and then filter it away, hiding the person by scan
 * order.
 *
 * `save` is read-then-write because the generic Store's saveResource is
 * an upsert with no create-only form: it refuses when the read finds a row
 * (the port: a held id is DuplicateAccountError, never a silent
 * overwrite). The residual window between the read and the write admits a
 * same-content overwrite of the first writer's audit stamp by
 * milliseconds; the primary key still guarantees ONE row per subject,
 * which is the invariant that matters. `readForWrite` and `swap` ARE
 * Store.readResourceForWrite and Store.swapResource, the guarded write.
 * Before either writes, both `save` and `swap` refuse an account whose
 * provider ref and federated mode disagree (the
 * port's shape line), so a refused write costs no store round trip.
 *
 * Store faults follow the store-fault mapping (domain/apikey/lookup.ts): a
 * typed ResourceNotFoundError reads as `undefined`; anything else
 * propagates — an outage must never read as "no account".
 *
 * The port's contract is proven by store-contract.ts, run over this
 * adapter on both drivers in __tests__/resource-store.postgres.test.ts, which
 * also pins the derived-id invariants above that are this adapter's own.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { GuardedRead } from "../../store/guarded-port.js";
import type { Store } from "../../store/interface.js";
import { accountIdFor, federatedAccountIdFor } from "./constants.js";
import { subjectIsOwn } from "./own-subject.js";
import { DuplicateAccountError } from "./store.js";
import type { IdentityAccountStore } from "./store.js";

const KIND = ApiResourceKind.identity_account;

export function newResourceIdentityAccountStore(
  store: Store,
): IdentityAccountStore {
  async function readById(id: string): Promise<IdentityAccount | undefined> {
    try {
      return await store.getResource(KIND, id, IdentityAccountSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /** The row for a subject — undefined for the empty subject, which no account carries. */
  async function readBySubject(
    idpId: string,
  ): Promise<IdentityAccount | undefined> {
    if (idpId === "") {
      return undefined;
    }
    return readById(accountIdFor(idpId));
  }

  return {
    async save(account): Promise<void> {
      refuseMixedShape(account);
      const id = account.metadata?.id ?? "";
      const idpId = account.spec?.idpId ?? "";
      if (subjectIsOwn(account) && id !== accountIdFor(idpId)) {
        throw new Error("direct account id must be derived from its idp_id");
      }
      if (isFederated(account) && id !== federatedAddressOf(account)) {
        throw new Error(
          "federated account id must be derived from its federation issuer and idp_id",
        );
      }
      if ((await readById(id)) !== undefined) {
        throw new DuplicateAccountError(
          `identity account '${id}' already exists`,
        );
      }
      await store.saveResource(KIND, id, IdentityAccountSchema, account);
    },

    async readForWrite(id): Promise<GuardedRead<IdentityAccount> | undefined> {
      try {
        const read = await store.readResourceForWrite(
          KIND,
          id,
          IdentityAccountSchema,
        );
        return { row: read.resource, bytes: read.bytes };
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },

    async swap(id, expectedBytes, next): Promise<boolean> {
      refuseMixedShape(next);
      return store.swapResource(
        KIND,
        id,
        IdentityAccountSchema,
        expectedBytes,
        next,
      );
    },

    async deleteById(id): Promise<void> {
      await store.deleteResource(KIND, id);
    },

    findById: readById,

    async findByIdpId(idpId): Promise<IdentityAccount | undefined> {
      const account = await readBySubject(idpId);
      return account !== undefined && !isFederated(account)
        ? account
        : undefined;
    },

    async findDirectByIdpId(idpId): Promise<IdentityAccount | undefined> {
      const account = await readBySubject(idpId);
      return account !== undefined && subjectIsOwn(account) ? account : undefined;
    },

    async findDirectByEmail(email): Promise<IdentityAccount | undefined> {
      const rows = await store.findAllByField(
        KIND,
        "spec.email",
        email,
        IdentityAccountSchema,
      );
      return rows
        .map((bytes) => fromBinary(IdentityAccountSchema, bytes))
        .find(subjectIsOwn);
    },

    async findByIds(ids): Promise<ReadonlyArray<IdentityAccount>> {
      const found: IdentityAccount[] = [];
      // One row per distinct id, at its first position (the port):
      // a Set iterates in insertion order, so the dedupe keeps the order.
      for (const id of new Set(ids)) {
        const account = await readById(id);
        if (account !== undefined) {
          found.push(account);
        }
      }
      return found;
    },

    async findByIssuerAndIdpId(
      providerId,
      idpId,
    ): Promise<IdentityAccount | undefined> {
      let id: string;
      try {
        id = federatedAccountIdFor(providerId, idpId);
      } catch {
        // An empty part, or a provider id holding the separator, names
        // no account: `save` refuses a federated row with either, so no
        // row carries it.
        return undefined;
      }
      const account = await readById(id);
      return account !== undefined &&
        isVouchedForBy(account, providerId) &&
        account.spec?.idpId === idpId
        ? account
        : undefined;
    },

    async findByIssuer(
      providerId,
    ): Promise<ReadonlyArray<IdentityAccount>> {
      if (providerId === "") {
        return [];
      }
      const rows = await store.findAllByField(
        KIND,
        "spec.federation_issuer_ref.id",
        providerId,
        IdentityAccountSchema,
      );
      return rows
        .map((bytes) => fromBinary(IdentityAccountSchema, bytes))
        .filter((account) => isVouchedForBy(account, providerId))
        .sort((a, b) => compareIds(a.metadata?.id ?? "", b.metadata?.id ?? ""));
    },

    async findByOrg(org): Promise<ReadonlyArray<IdentityAccount>> {
      if (org === "") {
        return [];
      }
      const rows = await store.findAllByField(
        KIND,
        "metadata.org",
        org,
        IdentityAccountSchema,
      );
      return rows.map((bytes) => fromBinary(IdentityAccountSchema, bytes));
    },
  };
}

/**
 * The port's shape line (store.ts): an account carries an
 * federation_issuer_ref if and only if its mode is `federated`. Both mixed
 * shapes are refused before any write, on `save` and on `swap` alike. A ref
 * under another mode is the row that split a person's sign-in (stigmer#1190):
 * every direct lookup skipped it, so the subject looked new. Mode `federated`
 * with no ref is a provider's subject that a driver which classifies by the
 * ref alone would answer for a platform person. With both refused, the two
 * readings below agree on every stored row.
 */
function refuseMixedShape(account: IdentityAccount): void {
  const hasIssuerRef = account.spec?.federationIssuerRef !== undefined;
  const isFederatedMode =
    account.spec?.provisioningMode ===
    IdentityAccountProvisioningMode.federated;
  if (hasIssuerRef !== isFederatedMode) {
    throw new Error(
      `identity account '${account.metadata?.id ?? ""}' mixes shapes: a federation issuer ref is carried exactly by a federated account`,
    );
  }
}

/**
 * The address a federated row must sit at: the derived id of its
 * provider and subject. `undefined` for a row whose reference cannot be
 * addressed (an empty part, a separator in a provider part), which `save`
 * then refuses as it refuses any other stray id.
 */
function federatedAddressOf(account: IdentityAccount): string | undefined {
  const ref = account.spec?.federationIssuerRef;
  try {
    return federatedAccountIdFor(ref?.id ?? "", account.spec?.idpId ?? "");
  } catch {
    return undefined;
  }
}

/** Whether a federated row names exactly this provider, by id, as the one that vouches for it. */
function isVouchedForBy(account: IdentityAccount, providerId: string): boolean {
  return (
    isFederated(account) &&
    account.spec?.federationIssuerRef?.id === providerId
  );
}

/** Code-unit order. Account ids are lowercase Crockford characters after a shared prefix, so a table's `ORDER BY id` agrees with it under any collation. */
function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A row a federation issuer vouches for: its subject is the provider's, reached only by the natural key. */
function isFederated(account: IdentityAccount): boolean {
  return (
    account.spec?.federationIssuerRef !== undefined ||
    account.spec?.provisioningMode === IdentityAccountProvisioningMode.federated
  );
}
