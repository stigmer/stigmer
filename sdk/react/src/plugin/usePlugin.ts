"use client";

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { isNotFound } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";

/** Return value of {@link usePlugin}. */
export interface UsePluginReturn {
  /** The installed plugin, or `null` while loading, on error, or when not installed. */
  readonly plugin: Plugin | null;
  /** `true` while the initial fetch or a refetch is in flight. */
  readonly isLoading: boolean;
  /** `true` while a background refetch is in flight. */
  readonly isRefetching: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch the plugin from the server. */
  readonly refetch: () => void;
}

/**
 * Data hook that fetches one installed Plugin by organization and slug.
 *
 * Wraps `stigmer.plugin.getByReference()` with loading, error and
 * not-found state. Pass `null` for `org` or `slug` to skip fetching
 * (stable no-op). A plugin that is not installed resolves to `plugin ===
 * null` with no error; `plugin === null && !isLoading && !error` is how a
 * consumer reads "not installed", the same three-field rule every detail
 * hook in this package follows.
 *
 * @example
 * ```tsx
 * const { plugin, isLoading } = usePlugin("acme", "thermos");
 * ```
 */
export function usePlugin(org: string | null, slug: string | null): UsePluginReturn {
  const stigmer = useStigmer();

  const { data: plugin, isLoading, isRefetching, error, refetch } = useFetch(
    org && slug
      ? async () => {
          try {
            return await stigmer.plugin.getByReference({ org, slug });
          } catch (err) {
            if (isNotFound(err)) return null;
            throw err;
          }
        }
      : null,
    [org, slug, stigmer],
    null,
  );

  return { plugin, isLoading, isRefetching, error, refetch };
}
