"use client";

import { useMemo } from "react";
import { create } from "@bufbuild/protobuf";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { ListPluginEvalsByPluginRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/io_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link usePluginEvals}. */
export interface UsePluginEvalsReturn {
  /** The plugin's evals, newest first; empty while loading. */
  readonly evals: readonly PluginEval[];
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the list (after starting or deleting an eval). */
  readonly refetch: () => void;
}

const NO_EVALS: readonly PluginEval[] = [];

/**
 * Data hook that lists a plugin's {@link PluginEval}s, newest first,
 * through `plugineval.listByPlugin()`. The plugin's viewers in its own
 * organization read them; a viewer from a child organization gets an
 * empty list, because a try spends the plugin's organization's credit.
 *
 * Pass an empty `pluginId` to skip fetching, while the plugin is loading.
 *
 * @example
 * ```tsx
 * const { evals } = usePluginEvals(plugin?.metadata?.id ?? "");
 * ```
 */
export function usePluginEvals(pluginId: string): UsePluginEvalsReturn {
  const stigmer = useStigmer();

  const { data, isLoading, error, refetch } = useFetch(
    pluginId
      ? async (): Promise<readonly PluginEval[]> =>
          (
            await stigmer.plugineval.listByPlugin(
              create(ListPluginEvalsByPluginRequestSchema, { pluginId }),
            )
          ).items
      : null,
    [pluginId, stigmer],
    NO_EVALS,
  );

  return useMemo(
    () => ({ evals: data, isLoading, error, refetch }),
    [data, isLoading, error, refetch],
  );
}
