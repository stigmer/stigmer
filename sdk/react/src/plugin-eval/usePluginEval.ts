"use client";

/**
 * Data hook for one plugin eval, read again while it runs so its tries fill
 * in as they finish.
 *
 * Polling, not a stream: an eval lasts minutes and changes a try at a time,
 * so a read every {@link PLUGIN_EVAL_POLL_MS} is cheap and needs no server
 * push. The hook stops asking once the eval is completed, partial or
 * failed, and an empty id asks nothing. Pinned by
 * `__tests__/hooks.test.tsx`.
 */

import { useEffect, useMemo, useState } from "react";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { isEvalActive } from "./eval-view.js";

/** How often a pending or running eval is read again, in milliseconds. */
export const PLUGIN_EVAL_POLL_MS = 3_000;

/** Return value of {@link usePluginEval}. */
export interface UsePluginEvalReturn {
  /** The eval, or `null` while loading. */
  readonly pluginEval: PluginEval | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the eval (after a cancel). */
  readonly refetch: () => void;
}

/**
 * Data hook that loads one {@link PluginEval} through `plugineval.get()`
 * and, while it is pending or running, reads it again every
 * {@link PLUGIN_EVAL_POLL_MS} so its tries fill in as they finish. Polling
 * stops once the eval is completed, partial or failed.
 *
 * Pass an empty `id` to skip fetching.
 *
 * @example
 * ```tsx
 * const { pluginEval } = usePluginEval("pev_01j5q3k7m8r2s4tnz2hfp0q0c3");
 * ```
 */
export function usePluginEval(id: string): UsePluginEvalReturn {
  const stigmer = useStigmer();
  // Asks again until the first answer says the eval has finished.
  const [polling, setPolling] = useState(true);

  const { data, isLoading, error, refetch } = useFetch(
    id
      ? async (): Promise<PluginEval | null> => stigmer.plugineval.get(id)
      : null,
    [id, stigmer],
    null,
    { refetchInterval: polling ? PLUGIN_EVAL_POLL_MS : false },
  );

  useEffect(() => {
    if (data !== null) setPolling(isEvalActive(data));
  }, [data]);

  return useMemo(
    () => ({ pluginEval: data, isLoading, error, refetch }),
    [data, isLoading, error, refetch],
  );
}
