// `stigmer access-history` dispatch: read an organization's access history,
// newest first, and export it as JSON Lines for a security team's tools.
//
// The history records every time someone was given or lost access to the
// organization or anything in it: who did it, why and when. It is read,
// all of it, by the organization's owners and admins (a parent's admins are
// admins in each child); an open-source server keeps none and says so, and that sentence reaches
// the user as the server wrote it.
//
// `list` reads newest first, up to `--limit` entries, following pages,
// and keeps the first page's word on retention: how many days the server
// keeps the history. `export` is the follow read: oldest first, after the
// last entry the caller holds (`--after`), every page, one entry per line,
// through `@stigmer/client`'s `exportAccessHistory`, so the console's download
// and this command write the same lines; when the server's retention
// removed entries after the caller's, the export says so once, apart from
// the lines.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  AccessChange,
  AccessChangeCause,
  type AccessHistoryEntry,
  type AccessHistoryPage,
  ListAccessHistoryInputSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import {
  accessHistoryJsonLine,
  exportAccessHistory,
  isDeletedReference,
  type RemovedAccessHistory,
  type Stigmer,
} from "@stigmer/client";
import { UsageError } from "../errors/usage-error.js";
import { readCursorPages } from "./cursor-pages.js";

/** The client these helpers call. */
export type AccessHistoryClient = Pick<Stigmer, "grant">;

/** The largest sequence there can be: a 64-bit signed integer. */
const MAX_SEQUENCE = BigInt("9223372036854775807");

/** The most entries one page of the history returns. */
const MAX_PAGE_SIZE = 100;

/** What `list` reads: the newest entries, and how long the server keeps the history. */
export interface AccessHistoryListing {
  readonly entries: AccessHistoryEntry[];
  /** Days the server keeps the history; 0 for good. */
  readonly retentionDays: number;
}

/** The newest `limit` entries, newest first, with the first page's retention window. */
export async function listAccessHistory(
  client: AccessHistoryClient,
  org: string,
  limit: number,
): Promise<AccessHistoryListing> {
  let first: AccessHistoryPage | undefined;
  const entries = await readCursorPages(limit, async (pageSize, pageToken) => {
    const page = await client.grant.listAccessHistory(
      create(ListAccessHistoryInputSchema, {
        org,
        pageSize: Math.min(pageSize, MAX_PAGE_SIZE),
        pageToken,
      }),
    );
    first ??= page;
    return page;
  });
  return { entries, retentionDays: first?.retentionDays ?? 0 };
}

/** The line `list` prints under its table: how long the server keeps the history. */
export function retentionLine(retentionDays: number): string {
  return retentionDays > 0
    ? `Entries older than ${retentionDays} ${retentionDays === 1 ? "day" : "days"} are removed.\n`
    : "Kept for good.\n";
}

/** The note `export` writes apart from the lines when the server removed entries after the caller's. */
export function removedNote(removed: RemovedAccessHistory): string {
  const run =
    removed.first === removed.last
      ? `entry ${removed.first} is`
      : `entries ${removed.first} to ${removed.last} are`;
  const why =
    removed.retentionDays > 0
      ? `this server removes entries older than ${removed.retentionDays} ${removed.retentionDays === 1 ? "day" : "days"}`
      : "this server removed them";
  return `${run} no longer kept: ${why}\n`;
}

/**
 * Writes every entry after `after`, oldest first, one JSON line each, and
 * a removed run, when there is one, as one note; answers how many lines it
 * wrote.
 */
export async function exportAccessHistoryLines(
  client: AccessHistoryClient,
  org: string,
  after: bigint,
  write: (line: string) => void,
  note: (line: string) => void,
): Promise<number> {
  let written = 0;
  const onRemoved = (removed: RemovedAccessHistory): void => {
    note(removedNote(removed));
  };
  for await (const entry of exportAccessHistory(client.grant, org, { after, onRemoved })) {
    write(`${accessHistoryJsonLine(entry)}\n`);
    written += 1;
  }
  return written;
}

/** `--after`: the last sequence the caller holds, a whole number. */
export function parseAfterSequence(raw: string | undefined): bigint {
  if (raw === undefined || raw === "") return BigInt(0);
  if (!/^\d{1,19}$/.test(raw) || BigInt(raw) > MAX_SEQUENCE) {
    throw new UsageError(`invalid --after value "${raw}"\n\nPass the last sequence you hold, such as --after 42.`);
  }
  return BigInt(raw);
}

export const ACCESS_HISTORY_TABLE_HEADERS = ["#", "WHEN", "CHANGE", "WHO", "ROLE", "ON", "BY", "WHY"] as const;

/** One table row per entry. */
export function accessHistoryRows(entries: readonly AccessHistoryEntry[]): string[][] {
  return entries.map((entry) => [
    entry.sequence.toString(),
    entry.occurredAt === undefined ? "" : timestampDate(entry.occurredAt).toISOString(),
    entry.change === AccessChange.revoked ? "removed" : "granted",
    granteeOf(entry),
    entry.role?.code ?? "",
    resourceOf(entry),
    actorOf(entry),
    AccessChangeCause[entry.cause] ?? "",
  ]);
}

function nameOf(view: AccessHistoryEntry["actor"]): string {
  return view?.email || view?.name || view?.id || "";
}

function granteeOf(entry: AccessHistoryEntry): string {
  const principal = entry.principal;
  const name = nameOf(principal);
  if (principal === undefined) return "";
  if (principal.relation !== "") return `${principal.kind} ${name} (${principal.relation}s)`;
  return principal.kind === "identity_account" ? name : `${principal.kind} ${name}`;
}

function resourceOf(entry: AccessHistoryEntry): string {
  const resource = entry.resource;
  if (resource === undefined) return "";
  const kind = ApiResourceKind[resource.kind] ?? "resource";
  if (isDeletedReference(resource)) return `${kind} ${resource.id} (deleted)`;
  return `${kind} ${resource.slug || resource.id}`;
}

function actorOf(entry: AccessHistoryEntry): string {
  if (entry.actorClass !== "internal") return nameOf(entry.actor);
  return entry.actor?.id ? `server, for ${nameOf(entry.actor)}` : "server";
}
