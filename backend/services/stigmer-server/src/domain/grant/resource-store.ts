/**
 * The open-source GrantStore: the port (store.ts) over the generic
 * Store, rows of the `resources` table by kind. The composition root
 * installs it when no extension registers
 * `drivers.grantStore`.
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
 * `listResources(grant)` and filters in memory: they serve the grant
 * path, the access lists and a boot reconcile, not the check, and the row
 * count behind them is members × organizations on a self-host. The filters are the cloud
 * store's WHERE clauses restated over the proto (store.ts names each), so
 * a driver's test over either edition reads the same contract.
 *
 * Writes. `save` refuses a grant whose id is not its triple's derived id
 * (constants.ts grantIdFor): open source has no legacy random ids, and a
 * stray id would break the primary key's promise of one row per triple.
 * It then stores the row through the Store's create-only
 * `insertResource`, whose answer decides a held id: false raises
 * DuplicateGrantError. The store's key decides a race, so of two
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
 * `listPermissionHistory`, each entry's bytes decoded back to the row, and
 * `pruneChanges` the Store's `prunePermissionHistory` and
 * `lastChangeSequence` its `permissionHistoryHead`; on open source the
 * tables are empty, so they answer nothing, remove nothing and read 0.
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

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import { GrantSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";

import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { PermissionChange } from "../../store/permission-history.js";
import type { GrantChange, GrantChangeRecord } from "./change.js";
import { USER_GRANT_PRINCIPAL_KINDS, grantIdFor } from "./constants.js";
import { grantListIndex } from "./list-index.js";
import { DuplicateGrantError } from "./store.js";
import type { GrantStore } from "./store.js";

const KIND = ApiResourceKind.grant;

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
export interface ResourceGrantStoreOptions {
  /** Record every access row change in the store's permission history (an edition above open source). */
  readonly keepsHistory: boolean;
}

/** The store's change for a grant path record, when the composition keeps a history and the row grants access. */
function permissionChangeOf(
  options: ResourceGrantStoreOptions,
  record: GrantChangeRecord | undefined,
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

export function newResourceGrantStore(
  store: Store,
  options: ResourceGrantStoreOptions,
): GrantStore {
  async function readById(id: string): Promise<Grant | undefined> {
    try {
      return await store.getResource(KIND, id, GrantSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  }

  /** Every row of the kind, decoded — the scan behind every read but by id and by principal. */
  async function all(): Promise<ReadonlyArray<Grant>> {
    const rows = await store.listResources(KIND);
    return rows.map((bytes) => fromBinary(GrantSchema, bytes));
  }

  async function where(
    predicate: (grant: Grant) => boolean,
  ): Promise<ReadonlyArray<Grant>> {
    return (await all()).filter(predicate);
  }

  return {
    async save(grant, record): Promise<void> {
      const id = grant.metadata?.id ?? "";
      if (grant.spec === undefined || id !== grantIdFor(grant.spec)) {
        throw new Error("grant id must be derived from its triple");
      }
      const inserted = await store.insertResource(
        KIND,
        id,
        GrantSchema,
        grant,
        permissionChangeOf(options, record),
      );
      if (!inserted) {
        throw new DuplicateGrantError(`grant '${id}' already exists`);
      }
    },

    async deleteById(id, record): Promise<void> {
      await store.deleteResource(KIND, id, permissionChangeOf(options, record));
    },

    findById: readById,

    async findByPrincipal(principalKind, principalId) {
      const rows = await store.queryResources(grantListIndex, {
        anyKey: [{ name: "principal", value: principalId }],
      });
      return rows
        .map((row) => fromBinary(GrantSchema, row.data))
        .filter((grant) => onPrincipal(grant, principalKind, principalId));
    },

    findByResource(resourceKind, resourceId) {
      return where((grant) => onResource(grant, resourceKind, resourceId));
    },

    findByPrincipalAndResource(
      principalKind,
      principalId,
      resourceKind,
      resourceId,
    ) {
      return where(
        (grant) =>
          onPrincipal(grant, principalKind, principalId) &&
          onResource(grant, resourceKind, resourceId),
      );
    },

    findByResourceWithRelations(resourceKind, resourceId, relations) {
      return where(
        (grant) =>
          onResource(grant, resourceKind, resourceId) &&
          relations.includes(relationOf(grant)),
      );
    },

    async countDistinctPrincipalsByResource(
      resourceKind,
      resourceId,
      principalKind,
      relations,
    ): Promise<number> {
      const principals = new Set<string>();
      for (const grant of await all()) {
        if (
          onResource(grant, resourceKind, resourceId) &&
          relations.includes(relationOf(grant)) &&
          (principalKind === undefined ||
            grant.spec?.principal?.kind === principalKind)
        ) {
          principals.add(
            `${grant.spec?.principal?.kind ?? ""}:${grant.spec?.principal?.id ?? ""}`,
          );
        }
      }
      return principals.size;
    },

    async listChanges(org, page): Promise<ReadonlyArray<GrantChange>> {
      const records = await store.listPermissionHistory(org, page);
      return records.map((record) => ({
        sequence: record.sequence,
        occurredAt: record.occurredAt,
        change: record.change,
        actor: { id: record.actorId, callerClass: record.actorClass },
        cause: record.cause,
        organizationId: record.org,
        grant: fromBinary(GrantSchema, record.data),
      }));
    },

    pruneChanges(before, limit) {
      return store.prunePermissionHistory(before, limit);
    },

    lastChangeSequence(org) {
      return store.permissionHistoryHead(org);
    },

    async findScopeTuple(resourceKind, resourceId) {
      return (await all()).find(
        (grant) =>
          onResource(grant, resourceKind, resourceId) &&
          !NON_STRUCTURAL_PRINCIPAL_KINDS.includes(
            grant.spec?.principal?.kind ?? "",
          ) &&
          !NON_STRUCTURAL_RELATIONS.includes(relationOf(grant)),
      );
    },
  };
}

function onPrincipal(grant: Grant, kind: string, id: string): boolean {
  return (
    grant.spec?.principal?.kind === kind && grant.spec?.principal?.id === id
  );
}

function onResource(grant: Grant, kind: string, id: string): boolean {
  return (
    grant.spec?.resource?.kind === kind && grant.spec?.resource?.id === id
  );
}

function relationOf(grant: Grant): string {
  return grant.spec?.relation ?? "";
}
