/**
 * The open-source IamPolicyStore: the port (store.ts) over the generic
 * Store, rows of the `resources` table by kind. The composition root
 * installs it when no extension registers
 * `drivers.iamPolicyStore`.
 *
 * Reads. `findById` is a PRIMARY-KEY read. `findByPrincipal` is an
 * INDEXED read through the kind's list index (list-index.ts), because the
 * built-in authorizer calls it on every check and every list batch — for
 * the person, and once more per team they belong to — and a scan there
 * costs a decode of every row the server holds, per call (measured
 * 2026-09-24: about 4.6 microseconds per row, 47 ms a check at ten
 * thousand rows on sqlite). The index narrows by the principal's id; the
 * (kind, id) predicate decides, so the answer is exact whatever the index
 * returns, and the store keeps it exact while an older binary still
 * writes (store/interface.ts, `queryResources`). Every other find decodes
 * `listResources(iam_policy)` and filters in memory: they serve the grant
 * path, the access lists and a boot reconcile, not the check, and the row
 * count behind them is members × organizations on a self-host. The filters are the cloud
 * store's WHERE clauses restated over the proto (store.ts names each), so
 * a driver's test over either edition reads the same contract.
 *
 * Writes. `save` refuses a policy whose id is not its triple's derived id
 * (constants.ts policyIdFor): open source has no legacy random ids, and a
 * stray id would break the primary key's promise of one row per triple.
 * It then stores the row through the Store's create-only
 * `insertResource`, whose answer decides a held id: false raises
 * DuplicatePolicyError. The store's key decides a race, so of two
 * concurrent saves of one triple exactly one fulfils and the other is the
 * duplicate the grant path already answers. `deleteById` is
 * `deleteResource`.
 *
 * History. A composition that keeps a permission history opens this
 * adapter with `keepsHistory` (boot/compose.ts: every edition above open
 * source). Then the change record the grant path hands `save` and
 * `deleteById` (store.ts) rides the store write, and the store appends one
 * entry in the row's own transaction, reading the row's triple and bytes
 * itself (store/permission-history.ts): none for a held id or an id not
 * held. Open source keeps none: the record is not passed, and the same
 * facts ride the grant path's log lines. `listChanges` is the Store's
 * `listPermissionHistory`, each entry's bytes decoded back to the row; on
 * open source the table is empty, so it answers nothing.
 *
 * Store faults follow the store-fault mapping (domain/apikey/lookup.ts): a
 * typed ResourceNotFoundError reads as `undefined`; anything else
 * propagates — an outage must never read as "no grant".
 *
 * The port's contract is proven by store-contract.ts, run over this
 * adapter on both drivers in __tests__/resource-store.postgres.test.ts, which also
 * pins the derived-id refusal that is this adapter's own.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { PermissionChange } from "../../store/permission-history.js";
import type { PolicyChange, PolicyChangeRecord } from "./change.js";
import { USER_GRANT_PRINCIPAL_KINDS, policyIdFor } from "./constants.js";
import { iamPolicyListIndex } from "./list-index.js";
import { DuplicatePolicyError } from "./store.js";
import type { IamPolicyStore } from "./store.js";

const KIND = ApiResourceKind.iam_policy;

/**
 * The cloud SQL's scope-tuple exclusions (store.ts): a scope tuple is a
 * row whose principal is a RESOURCE and whose relation is structural. The
 * principal half is derived from the user lane's grantee vocabulary
 * (constants.ts USER_GRANT_PRINCIPAL_KINDS) so the writer's "who a
 * person may grant to" and the reader's "what is a person, not a parent"
 * are one definition: the identity account and the team.
 */
const NON_STRUCTURAL_PRINCIPAL_KINDS: ReadonlyArray<string> =
  USER_GRANT_PRINCIPAL_KINDS.map((kind) => kindEnumName(kind));
const NON_STRUCTURAL_RELATIONS: ReadonlyArray<string> = ["owner", "creator"];

/** How the composition opens the adapter. */
export interface ResourceIamPolicyStoreOptions {
  /** Record every access row change in the store's permission history (an edition above open source). */
  readonly keepsHistory: boolean;
}

/** The store's change for a grant path record, when the composition keeps a history and the row grants access. */
function permissionChangeOf(
  options: ResourceIamPolicyStoreOptions,
  record: PolicyChangeRecord | undefined,
): PermissionChange | undefined {
  if (!options.keepsHistory || record === undefined) {
    return undefined;
  }
  return {
    cause: record.cause,
    actorId: record.actor.id,
    actorClass: record.actor.callerClass,
    org: record.organizationId,
  };
}

export function newResourceIamPolicyStore(
  store: Store,
  options: ResourceIamPolicyStoreOptions,
): IamPolicyStore {
  async function readById(id: string): Promise<IamPolicy | undefined> {
    try {
      return await store.getResource(KIND, id, IamPolicySchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /** Every row of the kind, decoded — the scan behind every read but by id and by principal. */
  async function all(): Promise<ReadonlyArray<IamPolicy>> {
    const rows = await store.listResources(KIND);
    return rows.map((bytes) => fromBinary(IamPolicySchema, bytes));
  }

  async function where(
    predicate: (policy: IamPolicy) => boolean,
  ): Promise<ReadonlyArray<IamPolicy>> {
    return (await all()).filter(predicate);
  }

  return {
    async save(policy, record): Promise<void> {
      const id = policy.metadata?.id ?? "";
      if (policy.spec === undefined || id !== policyIdFor(policy.spec)) {
        throw new Error("policy id must be derived from its triple");
      }
      const inserted = await store.insertResource(
        KIND,
        id,
        IamPolicySchema,
        policy,
        permissionChangeOf(options, record),
      );
      if (!inserted) {
        throw new DuplicatePolicyError(`IAM policy '${id}' already exists`);
      }
    },

    async deleteById(id, record): Promise<void> {
      await store.deleteResource(KIND, id, permissionChangeOf(options, record));
    },

    findById: readById,

    async findByPrincipal(principalKind, principalId) {
      const rows = await store.queryResources(iamPolicyListIndex, {
        anyKey: [{ name: "principal", value: principalId }],
      });
      return rows
        .map((row) => fromBinary(IamPolicySchema, row.data))
        .filter((policy) => onPrincipal(policy, principalKind, principalId));
    },

    findByResource(resourceKind, resourceId) {
      return where((policy) => onResource(policy, resourceKind, resourceId));
    },

    findByPrincipalAndResource(
      principalKind,
      principalId,
      resourceKind,
      resourceId,
    ) {
      return where(
        (policy) =>
          onPrincipal(policy, principalKind, principalId) &&
          onResource(policy, resourceKind, resourceId),
      );
    },

    findByResourceWithRelations(resourceKind, resourceId, relations) {
      return where(
        (policy) =>
          onResource(policy, resourceKind, resourceId) &&
          relations.includes(relationOf(policy)),
      );
    },

    async countDistinctPrincipalsByResource(
      resourceKind,
      resourceId,
      principalKind,
      relations,
    ): Promise<number> {
      const principals = new Set<string>();
      for (const policy of await all()) {
        if (
          onResource(policy, resourceKind, resourceId) &&
          relations.includes(relationOf(policy)) &&
          (principalKind === undefined ||
            policy.spec?.principal?.kind === principalKind)
        ) {
          principals.add(
            `${policy.spec?.principal?.kind ?? ""}:${policy.spec?.principal?.id ?? ""}`,
          );
        }
      }
      return principals.size;
    },

    findByResourceKindAndRelation(resourceKind, relation) {
      return where(
        (policy) =>
          policy.spec?.resource?.kind === resourceKind &&
          relationOf(policy) === relation,
      );
    },

    async listChanges(org, page): Promise<ReadonlyArray<PolicyChange>> {
      const records = await store.listPermissionHistory(org, page);
      return records.map((record) => ({
        sequence: record.sequence,
        occurredAt: record.occurredAt,
        change: record.change,
        actor: { id: record.actorId, callerClass: record.actorClass },
        cause: record.cause,
        organizationId: record.org,
        policy: fromBinary(IamPolicySchema, record.data),
      }));
    },

    async findScopeTuple(resourceKind, resourceId) {
      return (await all()).find(
        (policy) =>
          onResource(policy, resourceKind, resourceId) &&
          !NON_STRUCTURAL_PRINCIPAL_KINDS.includes(
            policy.spec?.principal?.kind ?? "",
          ) &&
          !NON_STRUCTURAL_RELATIONS.includes(relationOf(policy)),
      );
    },
  };
}

function onPrincipal(policy: IamPolicy, kind: string, id: string): boolean {
  return (
    policy.spec?.principal?.kind === kind && policy.spec?.principal?.id === id
  );
}

function onResource(policy: IamPolicy, kind: string, id: string): boolean {
  return (
    policy.spec?.resource?.kind === kind && policy.spec?.resource?.id === id
  );
}

function relationOf(policy: IamPolicy): string {
  return policy.spec?.relation ?? "";
}
