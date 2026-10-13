// `stigmer access-history` dispatch: read an organization's access history,
// newest first, and export it as JSON Lines for a security team's tools.
//
// The history records every time someone was given or lost access to the
// organization or anything in it: who did it, why and when. It is read by
// the organization's owners and admins (and a parent's admins for a child);
// an open-source server keeps none and says so, and that sentence reaches
// the user as the server wrote it.
//
// `list` reads newest first, up to `--limit` entries, following pages.
// `export` is the follow read: oldest first, after the last entry the
// caller holds (`--after`), every page, one entry per line, through
// `@stigmer/sdk`'s `exportAccessHistory`, so the console's download and
// this command write the same lines.

import { create } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import {
  AccessChange,
  AccessChangeCause,
  type AccessHistoryEntry,
  ListAccessHistoryInputSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  accessHistoryJsonLine,
  exportAccessHistory,
  isDeletedReference,
  type Stigmer,
} from "@stigmer/sdk";
import { UsageError } from "../errors/usage-error.js";
import { readCursorPages } from "./cursor-pages.js";

/** The client these helpers call. */
export type AccessHistoryClient = Pick<Stigmer, "iamPolicy">;

/** The most entries one page of the history returns. */
const MAX_PAGE_SIZE = 100;

/** The newest `limit` entries, newest first. */
export async function listAccessHistory(
  client: AccessHistoryClient,
  org: string,
  limit: number,
): Promise<AccessHistoryEntry[]> {
  return readCursorPages(limit, (pageSize, pageToken) =>
    client.iamPolicy.listAccessHistory(
      create(ListAccessHistoryInputSchema, {
        org,
        pageSize: Math.min(pageSize, MAX_PAGE_SIZE),
        pageToken,
      }),
    ),
  );
}

/** Writes every entry after `after`, oldest first, one JSON line each; answers how many it wrote. */
export async function exportAccessHistoryLines(
  client: AccessHistoryClient,
  org: string,
  after: bigint,
  write: (line: string) => void,
): Promise<number> {
  let written = 0;
  for await (const entry of exportAccessHistory(client.iamPolicy, org, { after })) {
    write(`${accessHistoryJsonLine(entry)}\n`);
    written += 1;
  }
  return written;
}

/** `--after`: the last sequence the caller holds, a whole number. */
export function parseAfterSequence(raw: string | undefined): bigint {
  if (raw === undefined || raw === "") return BigInt(0);
  if (!/^\d{1,19}$/.test(raw)) {
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
