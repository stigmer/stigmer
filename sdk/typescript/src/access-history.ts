/**
 * Exporting an organization's access history: every time someone was
 * given or lost access, who did it, why and when
 * (`IamPolicyClient.listAccessHistory`).
 *
 * The export is the history's follow read: oldest first, strictly after
 * the last entry the caller already holds, every page followed. Each
 * organization numbers its entries from 1 in the order they happened, with
 * no gaps, so a tool that stores the last `sequence` it wrote and asks for
 * what came after it next time never misses an entry.
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

/** Where an export starts. */
export interface ExportAccessHistoryOptions {
  /**
   * The last sequence the caller already holds: the export starts just
   * after it. Absent or 0, it starts at the organization's first entry.
   */
  readonly after?: bigint;
  /** Stops the export between pages. */
  readonly signal?: AbortSignal;
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
  let pageToken = "";
  do {
    options.signal?.throwIfAborted();
    const page = await client.listAccessHistory(
      create(ListAccessHistoryInputSchema, {
        org,
        afterSequence: options.after ?? 0n,
        pageSize: EXPORT_PAGE_SIZE,
        pageToken,
      }),
    );
    yield* page.entries;
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
}

/** One entry as one JSON Lines line (no trailing newline): its canonical proto JSON. */
export function accessHistoryJsonLine(entry: AccessHistoryEntry): string {
  return toJsonString(AccessHistoryEntrySchema, entry);
}
