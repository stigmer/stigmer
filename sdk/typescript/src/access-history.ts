/**
 * Exporting an organization's access history: every time someone was
 * given or lost access, who did it, why and when
 * (`IamPolicyClient.listAccessHistory`).
 *
 * The export is the history's follow read: oldest first, strictly after
 * the last entry the caller already holds, every page followed. Each
 * organization numbers its entries from 1 in the order they happened, with
 * no gaps, so a tool that stores the last `sequence` it wrote and asks for
 * what came after it next time never misses an entry the server still
 * keeps.
 *
 * A server may keep the history for a limited time, set by its operator,
 * and remove the oldest entries first. Every page says the oldest number
 * the organization still holds (`oldestSequence`; when every entry was
 * removed, the number its next entry will get) and how many days the
 * server keeps the history (`retentionDays`, 0 for good). When a tool asks
 * after N and the oldest kept entry is above N + 1, the entries between
 * were removed, not missed: `onRemoved` hears that once, before the first
 * entry, so a tool can record the run it will never receive. Any other gap
 * in the numbers is a parent organization's administrator not being shown
 * the entries about a child's resources.
 *
 * One format for every surface (the CLI's `access-history export`, the
 * console's download): JSON Lines, one entry per line, each line the
 * entry's canonical proto JSON. Proto JSON writes the 64-bit `sequence` as
 * a string ("42"), and enum values by name ("granted", "grant").
 */
import { create, toJsonString } from "@bufbuild/protobuf";
import {
  AccessHistoryEntrySchema,
  ListAccessHistoryInputSchema,
  type AccessHistoryEntry,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";

import type { IamPolicyClient } from "./gen/iampolicy.js";

export type { AccessHistoryEntry };

/** The most entries one page of the history returns. */
const EXPORT_PAGE_SIZE = 100;

/** A run of entries the server removed before the export reached them. */
export interface RemovedAccessHistory {
  /** The first removed sequence: just after the one the caller holds. */
  readonly first: bigint;
  /** The last removed sequence: just before the oldest the server keeps. */
  readonly last: bigint;
  /** How many days the server keeps the history; 0 when it keeps it for good now. */
  readonly retentionDays: number;
}

/** Where an export starts, and what it is told on the way. */
export interface ExportAccessHistoryOptions {
  /**
   * The last sequence the caller already holds: the export starts just
   * after it. Absent or 0, it starts at the oldest entry the server keeps.
   */
  readonly after?: bigint;
  /** Stops the export between pages. */
  readonly signal?: AbortSignal;
  /**
   * Called once, before the first entry, when entries after `after` were
   * removed by the server's retention: the export starts after them.
   */
  readonly onRemoved?: (removed: RemovedAccessHistory) => void;
}

/**
 * Every entry of `org`'s access history after `options.after`, oldest
 * first, following every page until the newest entry.
 */
export async function* exportAccessHistory(
  client: Pick<IamPolicyClient, "listAccessHistory">,
  org: string,
  options: ExportAccessHistoryOptions = {},
): AsyncGenerator<AccessHistoryEntry, void, undefined> {
  const after = options.after ?? BigInt(0);
  let pageToken = "";
  let first = true;
  do {
    options.signal?.throwIfAborted();
    const page = await client.listAccessHistory(
      create(ListAccessHistoryInputSchema, {
        org,
        afterSequence: after,
        pageSize: EXPORT_PAGE_SIZE,
        pageToken,
      }),
    );
    // Only the first page's oldest number is the one the export started
    // from; a later page's may have moved on while the export ran.
    if (first && page.oldestSequence > after + BigInt(1)) {
      options.onRemoved?.({
        first: after + BigInt(1),
        last: page.oldestSequence - BigInt(1),
        retentionDays: page.retentionDays,
      });
    }
    first = false;
    yield* page.entries;
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
}

/** One entry as one JSON Lines line (no trailing newline): its canonical proto JSON. */
export function accessHistoryJsonLine(entry: AccessHistoryEntry): string {
  return toJsonString(AccessHistoryEntrySchema, entry);
}
