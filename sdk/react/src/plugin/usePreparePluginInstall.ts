"use client";

import { useMemo } from "react";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { type OpenedMarketplace, type PreparedInstall, findEntry, prepareEntry } from "./sources/read.js";

/**
 * How the prepared archive relates to what the organization already holds.
 *
 * - `not-installed`: no plugin of this name in the org.
 * - `installed`: the org's plugin carries this exact digest and is ready.
 * - `upgrade`: the org's plugin exists with another digest (or is not
 *   ready); a push replaces its members.
 */
export type InstallRelation = "not-installed" | "installed" | "upgrade";

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
 * Behaviour hook that turns a marketplace entry into the push the server
 * expects, and says whether the organization already holds it.
 *
 * The entry's subtree is fetched at the tree's commit, selected by the
 * shared rule, read by the library, archived and digested, so `prepared.
 * digest` is the digest `stigmer install` would compute for the same tree
 * and the digest the server records after the push. The org's plugin of
 * the same name is read by reference; equal digest and READY is
 * `installed`, anything else present is `upgrade`.
 *
 * Pass `null` for `opened`, `entryName` or `org` to skip (stable no-op).
 */
export function usePreparePluginInstall(
  opened: OpenedMarketplace | null,
  entryName: string | null,
  org: string | null,
): UsePreparePluginInstallReturn {
  const stigmer = useStigmer();
  const entry = opened && entryName ? findEntry(opened.marketplace, entryName) : undefined;

  const { data, isLoading, error, refetch } = useFetch(
    opened && entry && org
      ? async () => {
          const [prepared, installed] = await Promise.all([
            prepareEntry(opened, entry),
            stigmer.plugin.getByReference({ org, slug: entry.name }).catch((err: unknown) => {
              if (isNotFound(err)) return null;
              throw err;
            }),
          ]);
          return { prepared, installed };
        }
      : null,
    [opened, entry, org, stigmer],
    null,
  );

  const relation = useMemo<InstallRelation | null>(() => {
    if (data === null) return null;
    if (data.installed === null) return "not-installed";
    const status = data.installed.status;
    return status?.digest === data.prepared.digest && status.state === PluginState.READY ? "installed" : "upgrade";
  }, [data]);

  return useMemo(
    () => ({
      prepared: data?.prepared ?? null,
      installed: data?.installed ?? null,
      relation,
      isPreparing: isLoading,
      error,
      refetch,
    }),
    [data, relation, isLoading, error, refetch],
  );
}
