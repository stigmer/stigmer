/**
 * The open-source IdentityAccountStore: the port (store.ts) over the
 * generic Store, rows of the `resources` table by kind (20260911.11,
 * T01_1_review.md A1). The composition root installs it when no
 * extension registers `drivers.identityAccountStore`.
 *
 * Every subject lookup is a PRIMARY-KEY read of the derived id
 * (constants.ts accountIdFor): open source has no legacy random ids, so
 * "the account with subject S" IS "the row with id accountIdFor(S)". That
 * is what makes the OIDC lane's per-request resolve, whoAmI and the
 * provisioning idempotency check O(1) reads with no secondary index and
 * no scan, and it is why `save` refuses a direct account whose id is not
 * its derived id — a stray row would be unreachable by subject forever.
 * `findDirectByEmail` is the one lookup that scans (Store.findByField, a
 * decode-and-scan of the kind's rows, T01_1_review.md finding 2): an
 * administrative RPC, never a per-request path.
 *
 * `save` and `update` are both read-then-write because the generic
 * Store's saveResource is an upsert with neither a create-only nor an
 * update-only form. `save` refuses when the read finds a row (the port:
 * a held id is DuplicateAccountError, never a silent overwrite); `update`
 * returns when the read finds none (the port, A12: replace, never
 * create — a driver whose UPDATE matches no row writes nothing, and this
 * adapter must not differ). The residual window between the read and
 * the write admits a same-content overwrite of the first writer's audit
 * stamp, or a row recreated under a concurrent delete, by milliseconds —
 * the posture every chain on the platform has today (CheckDuplicate then
 * upsert); conditional store writes are a platform-wide follow-up, not
 * this adapter's to invent. The primary key still guarantees ONE row per
 * subject, which is the invariant that matters.
 *
 * Store faults follow the ratified mapping (domain/apikey/lookup.ts): a
 * typed ResourceNotFoundError reads as `undefined`; anything else
 * propagates — an outage must never read as "no account".
 *
 * The port's contract is proven by store-contract.ts, run over this
 * adapter on both drivers in __tests__/resource-store.test.ts, which
 * also pins the two invariants above that are this adapter's own.
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";

import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { accountIdFor } from "./constants.js";
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
      const id = account.metadata?.id ?? "";
      const idpId = account.spec?.idpId ?? "";
      if (isDirect(account) && id !== accountIdFor(idpId)) {
        throw new Error("direct account id must be derived from its idp_id");
      }
      if ((await readById(id)) !== undefined) {
        throw new DuplicateAccountError(
          `identity account '${id}' already exists`,
        );
      }
      await store.saveResource(KIND, id, IdentityAccountSchema, account);
    },

    async update(account): Promise<void> {
      const id = account.metadata?.id ?? "";
      if ((await readById(id)) === undefined) {
        return;
      }
      await store.saveResource(KIND, id, IdentityAccountSchema, account);
    },

    async deleteById(id): Promise<void> {
      await store.deleteResource(KIND, id);
    },

    findById: readById,

    findByIdpId: readBySubject,

    async findDirectByIdpId(idpId): Promise<IdentityAccount | undefined> {
      const account = await readBySubject(idpId);
      return account !== undefined && isDirect(account) ? account : undefined;
    },

    async findDirectByEmail(email): Promise<IdentityAccount | undefined> {
      let account: IdentityAccount;
      try {
        account = await store.findByField(
          KIND,
          "spec.email",
          email,
          IdentityAccountSchema,
        );
      } catch (error) {
        if (error instanceof ResourceNotFoundError) {
          return undefined;
        }
        throw error;
      }
      return isDirect(account) ? account : undefined;
    },

    async findByIds(ids): Promise<ReadonlyArray<IdentityAccount>> {
      const found: IdentityAccount[] = [];
      // One row per distinct id, at its first position (the port, A12):
      // a Set iterates in insertion order, so the dedupe keeps the order.
      for (const id of new Set(ids)) {
        const account = await readById(id);
        if (account !== undefined) {
          found.push(account);
        }
      }
      return found;
    },
  };
}

/**
 * Non-federated: the platform's own subject. A federated account carries
 * its identity_provider_ref; open source never writes one (its create
 * path assigns `direct`), so this is the port's contract stated, not a
 * branch the OSS store expects to take.
 */
function isDirect(account: IdentityAccount): boolean {
  return (
    account.spec?.identityProviderRef === undefined &&
    account.spec?.provisioningMode !== IdentityAccountProvisioningMode.federated
  );
}
