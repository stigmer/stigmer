"use client";

import { useMemo } from "react";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { useFetch } from "../internal/useFetch.js";
import { type OpenedMarketplace, type PreparedInstall, findEntry, prepareEntry } from "./sources/read.js";
import { type InstallRelation, useInstallRelation } from "./useInstallRelation.js";

export type { InstallRelation } from "./useInstallRelation.js";

/** Return value of {@link usePreparePluginInstall}. */
export interface UsePreparePluginInstallReturn {
  /** The entry read, selected and archived; `null` while preparing or on refusal. */
  readonly prepared: PreparedInstall | null;
  /** The org's plugin of the same name, or `null` when none is installed. */
  readonly installed: Plugin | null;
  readonly relation: InstallRelation | null;
  /** `true` while the entry's files are fetched and read, or the org is asked. */
  readonly isPreparing: boolean;
  /** The reader's refusal (every sentence) or the source's, or `null`. */
  readonly error: Error | null;
  /** Fetch and read the entry again. */
  readonly refetch: () => void;
}

/**
 * Behaviour hook that turns a source's entry into the push the server
 * expects, and says whether the organization already holds it.
 *
 * The entry's subtree is handed to the one preparation every client runs
 * (the ignore files, the selection, then only the selected files, read at
 * the tree's commit), so `prepared.digest` is the digest `stigmer install`
 * would compute for the same tree and the digest the server records after
 * the push. The relation to the org's plugin of the same name is
 * `useInstallRelation`'s, shared with the upload path.
 *
 * Pass `null` for `opened`, `entryName` or `org` to skip (stable no-op).
 */
export function usePreparePluginInstall(
  opened: OpenedMarketplace | null,
  entryName: string | null,
  org: string | null,
): UsePreparePluginInstallReturn {
  const entry = opened && entryName ? findEntry(opened.marketplace, entryName) : undefined;

  const prepare = useFetch<PreparedInstall | null>(
    opened && entry ? () => prepareEntry(opened, entry) : null,
    [opened, entry],
    null,
  );
  const relation = useInstallRelation(prepare.data, org);

  return useMemo(
    () => ({
      prepared: prepare.data,
      installed: relation.installed,
      relation: relation.relation,
      isPreparing: prepare.isLoading || relation.isLoading,
      error: prepare.error ?? relation.error,
      refetch: prepare.refetch,
    }),
    [prepare.data, prepare.isLoading, prepare.error, prepare.refetch, relation],
  );
}
