"use client";

/**
 * Pure derivation of what was given to a conversation: its Files that no
 * turn returned (chat-box uploads, attached folders' files, a routine's or
 * the Library's Files the conversation holds a copy of, a channel's media),
 * newest first, each named by where the agent finds it.
 *
 * Trade-offs:
 * - "Given" is every File of the conversation with no run id, not only the
 *   ones its resources name: the list is what the conversation holds, the
 *   same set the server deletes with it.
 * - A File's place is read from the conversation's own `file` resources,
 *   where the server settles it (an attached folder's `q3/ledger.csv`, or a
 *   second `report.pdf` stored as `report-2.pdf`); a File no resource names
 *   is placed by its filename, the server's default. So two `a.csv` from two
 *   folders stay apart, and the row says what the agent sees.
 */

import { useMemo } from "react";
import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { SessionResource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/resource_pb";

/** The folder a conversation's given Files are placed under, from the workspace root. */
export const UPLOADS_FOLDER = ".stigmer/uploads";

/** One File given to the conversation, and where the agent finds it. */
export interface SessionGivenEntry {
  /** The File. */
  readonly file: StigmerFile;
  /**
   * Where the agent finds it, relative to {@link UPLOADS_FOLDER}: the
   * resource's settled `mount_path`, or the filename when none is set.
   */
  readonly place: string;
}

/** Return value of {@link useSessionGivenFiles}. */
export interface UseSessionGivenFilesReturn {
  /** The given Files, newest first. */
  readonly given: readonly SessionGivenEntry[];
  /** Number of entries. */
  readonly givenCount: number;
}

/**
 * The identity of a given File's document tab: its place under the uploads
 * folder. It cannot alias an output's tab, whose identity is its path inside
 * the outputs folder, and its last segment is the tab's label.
 */
export function givenKey(entry: SessionGivenEntry): string {
  return `${UPLOADS_FOLDER}/${entry.place}`;
}

/**
 * Lists the Files given to a conversation, each with its place.
 *
 * @param files - The conversation's Files, newest first (`useSessionFiles`).
 * @param resources - The conversation's `spec.resources`, where each given
 *   File's place is settled.
 */
export function useSessionGivenFiles(
  files: readonly StigmerFile[],
  resources: readonly SessionResource[],
): UseSessionGivenFilesReturn {
  return useMemo(() => deriveSessionGivenFiles(files, resources), [files, resources]);
}

/** The derivation behind {@link useSessionGivenFiles}, for non-hook callers and tests. */
export function deriveSessionGivenFiles(
  files: readonly StigmerFile[],
  resources: readonly SessionResource[],
): UseSessionGivenFilesReturn {
  const places = new Map<string, string>();
  for (const resource of resources) {
    if (resource.resource.case !== "file") continue;
    const { fileId, mountPath } = resource.resource.value;
    if (fileId && mountPath) places.set(fileId, mountPath);
  }
  const given = files
    .filter((file) => (file.status?.runId ?? "") === "")
    .map((file) => ({
      file,
      place: places.get(file.metadata?.id ?? "") || file.spec?.filename || file.metadata?.id || "",
    }));
  return { given, givenCount: given.length };
}
