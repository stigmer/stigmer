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
 * Removal. No member of the Store updates an entry, and an organization's
 * purge leaves its history in place. One member removes: retention
 * (`Store.prunePermissionHistory`) deletes the entries recorded before a
 * cutoff, oldest first by time, then organization, then number. Because an
 * organization's times never go back as its numbers rise, the entries
 * older than any instant are a prefix of its numbers, so removal leaves
 * each organization one unbroken run ending at its newest entry. The heads
 * are never removed, so a number is never handed out twice.
 *
 * Reading. `Store.listPermissionHistory` reads one organization's entries
 * on the primary key, newest first below a number or oldest first above
 * one, a bounded page at a time (`PermissionHistoryPage`). Because numbers
 * are assigned in commit order with no gaps, "everything after N" read now
 * and again later never skips an entry above the oldest kept one.
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

/**
 * Which entries of an organization one read returns: newest first, below
 * `before` when given; or, with `after`, oldest first, above it. At most
 * `limit` (a positive integer) either way.
 */
export type PermissionHistoryPage =
  | { readonly limit: number; readonly before?: bigint }
  | { readonly limit: number; readonly after: bigint };

/** One stored entry as a reader gets it: its columns, with the number and time the driver assigned. */
export interface PermissionHistoryRecord extends PermissionHistoryEntry {
  readonly sequence: bigint;
  readonly occurredAt: string;
}

/**
 * A retention batch in the drivers' terms: the cutoff as the fixed-width
 * text the writers stamp (rfc3339.ts `instantNotBefore`), so comparing the
 * column as bytes compares times, and the limit refused when it is not a
 * positive integer.
 */
export function permissionHistoryPruneBounds(
  before: Date,
  limit: number,
): { readonly cutoff: string; readonly limit: number } {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(
      `permission history limit must be a positive integer, got ${limit}`,
    );
  }
  return { cutoff: before.toISOString(), limit };
}

/** A page's bound and direction in the drivers' terms, its limit refused when it is not a positive integer. */
export function permissionHistoryBounds(page: PermissionHistoryPage): {
  readonly ascending: boolean;
  readonly bound: bigint | undefined;
  readonly limit: number;
} {
  if (!Number.isSafeInteger(page.limit) || page.limit <= 0) {
    throw new Error(
      `permission history limit must be a positive integer, got ${page.limit}`,
    );
  }
  if ("after" in page) {
    return { ascending: true, bound: page.after, limit: page.limit };
  }
  return { ascending: false, bound: page.before, limit: page.limit };
}

/** A stored row, as either driver's client returns it, in the reader's shape. */
export function permissionHistoryRecordOf(
  row: Record<string, unknown>,
): PermissionHistoryRecord {
  const text = (column: string): string => String(row[column]);
  return {
    org: text("org"),
    sequence: BigInt(row.sequence as string | number | bigint),
    occurredAt: text("occurred_at"),
    change: text("change") as PermissionHistoryChange,
    cause: text("cause"),
    actorId: text("actor_id"),
    actorClass: text("actor_class"),
    policyId: text("policy_id"),
    principalKind: text("principal_kind"),
    principalId: text("principal_id"),
    principalRelation: text("principal_relation"),
    relation: text("relation"),
    resourceKind: text("resource_kind"),
    resourceId: text("resource_id"),
    data: new Uint8Array(row.data as Uint8Array),
  };
}

/** The columns a read selects, in one place for both drivers. */
export const PERMISSION_HISTORY_COLUMNS =
  "org, sequence, occurred_at, change, cause, actor_id, actor_class, policy_id, " +
  "principal_kind, principal_id, principal_relation, relation, resource_kind, resource_id, data";

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
