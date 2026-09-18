"use client";

/**
 * How a prepared archive relates to what the organization already holds,
 * asked once per digest.
 *
 * A prepared install carries the digest the server would record, so the
 * question "is this already installed" is answered before a push, from the
 * org's plugin of the same name: equal digest and READY is `installed`,
 * anything else present is `upgrade`, nothing is `not-installed`. Every
 * preview asks it, whether the archive came from a source's entry or from
 * the user's own folder, so it is one hook and the preparation hooks
 * compose it.
 */

import { useMemo } from "react";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginState } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import type { PreparedInstall } from "./sources/read.js";

/**
 * - `not-installed`: no plugin of this name in the org.
 * - `installed`: the org's plugin carries this exact digest and is ready.
 * - `upgrade`: the org's plugin exists with another digest (or is not
 *   ready); a push replaces its members.
 */
export type InstallRelation = "not-installed" | "installed" | "upgrade";

/** Return value of {@link useInstallRelation}. */
export interface UseInstallRelationReturn {
  /** The org's plugin of the same name, or `null` when none is installed (or not yet asked). */
  readonly installed: Plugin | null;
  readonly relation: InstallRelation | null;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refetch: () => void;
}

/** Pass `null` for either argument to skip (stable no-op). */
export function useInstallRelation(prepared: PreparedInstall | null, org: string | null): UseInstallRelationReturn {
  const stigmer = useStigmer();
  const name = prepared?.plugin.name ?? null;
  const digest = prepared?.digest ?? null;

  const { data, isLoading, error, refetch } = useFetch<Plugin | null | undefined>(
    name && org
      ? () =>
          stigmer.plugin.getByReference({ org, slug: name }).catch((err: unknown) => {
            if (isNotFound(err)) return null;
            throw err;
          })
      : null,
    [name, org, stigmer],
    // `undefined` while nothing has been asked; `null` is a real "not installed" answer.
    undefined,
  );

  const relation = useMemo<InstallRelation | null>(() => {
    if (data === undefined || digest === null) return null;
    if (data === null) return "not-installed";
    const status = data.status;
    return status?.digest === digest && status.state === PluginState.READY ? "installed" : "upgrade";
  }, [data, digest]);

  return useMemo(
    () => ({ installed: data ?? null, relation, isLoading, error, refetch }),
    [data, relation, isLoading, error, refetch],
  );
}
