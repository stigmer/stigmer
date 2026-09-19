"use client";

/**
 * Data hook for a card's face: the display name, logo, author and version
 * of one marketplace entry, read from its manifest when the card is shown.
 *
 * The catalogue listing never opens a plugin (one file lists eighty), so a
 * card asks for its own presentation, one small read per card, through
 * `useFetch` with a cache key, so the SDK's `FetchCacheProvider` remembers
 * it across mounts the way it remembers every other data hook's answer. A
 * logo becomes a URL the browser loads itself, at the commit or version
 * the tree was read at; nothing image-shaped travels through JavaScript.
 */

import { useMemo } from "react";
import type { MarketplaceEntry, PluginPresentation } from "@stigmer/plugin-package";
import { readPluginPresentationFromTree } from "@stigmer/plugin-package/client";

import { useFetch } from "../internal/useFetch.js";
import { type OpenedMarketplace, entryCandidates } from "./sources/read.js";

/** Return value of {@link usePluginPresentation}. */
export interface UsePluginPresentationReturn {
  /** What the manifest says; every field optional, `{}` until read or when the manifest says nothing. */
  readonly presentation: PluginPresentation;
  /** The logo's URL at the tree's commit or version, or `null` when the plugin names none the tree can show. */
  readonly logoUrl: string | null;
  /** `true` until the manifest has been read once. */
  readonly isLoading: boolean;
}

const NOTHING: PluginPresentation = {};

/**
 * The presentation of `entry` in `opened`; idle (and `{}`) when either is `null`.
 *
 * @example
 * ```tsx
 * const { presentation, logoUrl } = usePluginPresentation(opened, entry);
 * const title = presentation.displayName ?? entry.name;
 * ```
 */
export function usePluginPresentation(opened: OpenedMarketplace | null, entry: MarketplaceEntry | null): UsePluginPresentationReturn {
  // The tree's phrase names one commit or version, so with the directory it identifies the read.
  const identity = opened && entry ? `${opened.tree.describe}:${entry.dir}` : null;

  const { data: presentation, isLoading } = useFetch(
    opened && entry ? () => readPluginPresentationFromTree(entryCandidates(opened, entry)) : null,
    [identity],
    NOTHING,
    identity === null ? {} : { cacheKey: `plugin-presentation:${identity}` },
  );

  const logoUrl = useMemo(() => {
    if (!opened || !entry || presentation.logo === undefined) return null;
    return opened.tree.fileUrl(entry.dir === "" ? presentation.logo : `${entry.dir}/${presentation.logo}`);
  }, [opened, entry, presentation.logo]);

  return useMemo(() => ({ presentation, logoUrl, isLoading }), [presentation, logoUrl, isLoading]);
}
