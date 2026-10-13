/**
 * The permission history: one entry for every change to an access row,
 * written by the store in the same transaction as the row
 * (`Store.insertResource` and `Store.deleteResource` with a change). An
 * edition that keeps a history hands the change; open source hands none
 * and the table stays empty (domain/iampolicy/resource-store.ts).
 *
 * What a writer hands is who, why and where: the cause, the actor and the
 * organization. Everything the entry says about the row itself (its id,
 * its triple, its bytes) the store reads from the row it wrote or removed,
 * so an entry can never describe a row other than the one that changed,
 * and a delete records the row as it stood with no read before it. This
 * module is that derivation, the one place a store decodes the policy
 * bytes for the history; the drivers own the SQL.
 *
 * Numbering. Entries are numbered per organization from a head row that
 * never goes back (`iam_policy_history_heads`), one writer per
 * organization at a time: Postgres takes a transaction-scoped advisory lock
 * on the organization before the row, SQLite runs under BEGIN IMMEDIATE.
 * An organization's entries are therefore numbered in commit order with no
 * gaps, and a reader that resumes after entry N never misses one that
 * committed late. Times are fixed-width UTC with milliseconds that never go
 * back (rfc3339.ts `instantNotBefore`). An entry whose row is in no
 * organization is numbered in the "" lane.
 *
 * The table is append-only here: no member of the Store updates or deletes
 * an entry, and an organization's purge leaves its history in place.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPolicySchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";

import { apiResourceKindName } from "./proto-fields.js";

/**
 * Who changed an access row, through which door, in which organization:
 * what a writer hands the store beside the row. The strings are stored as
 * given; the table refuses an empty cause, which rolls the row back too.
 */
export interface PermissionChange {
  readonly cause: string;
  readonly actorId: string;
  readonly actorClass: string;
  readonly org: string;
}

/** What happened to the row. Stored bytes. */
export type PermissionHistoryChange = "granted" | "revoked";

/** One entry's columns but its number and time, which the driver assigns under the organization's lock. */
export interface PermissionHistoryEntry {
  readonly org: string;
  readonly change: PermissionHistoryChange;
  readonly cause: string;
  readonly actorId: string;
  readonly actorClass: string;
  readonly policyId: string;
  readonly principalKind: string;
  readonly principalId: string;
  readonly principalRelation: string;
  readonly relation: string;
  readonly resourceKind: string;
  readonly resourceId: string;
  readonly data: Uint8Array;
}

/** Refuses a change for a kind other than the access row's, before anything is written. */
export function assertPermissionChangeKind(
  kind: ApiResourceKind,
  change: PermissionChange | undefined,
): void {
  if (change !== undefined && kind !== ApiResourceKind.iam_policy) {
    throw new Error(
      `a permission change is recorded only with an iam_policy row, not ${apiResourceKindName(kind)}`,
    );
  }
}

/** The entry for a row the store just wrote or removed, read from the row's own bytes. */
export function permissionHistoryEntryOf(
  change: PermissionChange,
  what: PermissionHistoryChange,
  policyId: string,
  data: Uint8Array,
): PermissionHistoryEntry {
  const spec = fromBinary(IamPolicySchema, data).spec;
  return {
    org: change.org,
    change: what,
    cause: change.cause,
    actorId: change.actorId,
    actorClass: change.actorClass,
    policyId,
    principalKind: spec?.principal?.kind ?? "",
    principalId: spec?.principal?.id ?? "",
    principalRelation: spec?.principal?.relation ?? "",
    relation: spec?.relation ?? "",
    resourceKind: spec?.resource?.kind ?? "",
    resourceId: spec?.resource?.id ?? "",
    data,
  };
}
