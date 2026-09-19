"use client";

/**
 * Data hook over every source at once: the reads a storefront draws one
 * grid from. `useMarketplace` reads one source; this reads a list of them
 * through `MarketplaceCatalogStore`, so a consumer gets one snapshot with
 * one entry per source, each reading, ready or failed on its own, and a
 * `refetch` per source. `catalogEntries` flattens the ready ones into the
 * cards a grid shows, each entry keeping the source and the opened tree an
 * install needs.
 */

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import type { MarketplaceEntry } from "@stigmer/plugin-package";

import { useStigmer } from "../hooks.js";
import { MarketplaceCatalogStore, type OpenSource, type SourceRead } from "./catalog-store.js";
import { openMarketplaceSource } from "./sources/open.js";
import type { OpenedMarketplace } from "./sources/read.js";
import type { FetchImpl, KnownMarketplace, MarketplaceSource } from "./sources/types.js";

export type { SourceRead, SourceReadState } from "./catalog-store.js";

/** Options for {@link useMarketplaceCatalog}. */
export interface UseMarketplaceCatalogOptions {
  /** The HTTP client the sources are read through; `globalThis.fetch` when absent. Tests inject a fake. */
  readonly fetchImpl?: FetchImpl;
}

/** Return value of {@link useMarketplaceCatalog}. */
export interface UseMarketplaceCatalogReturn {
  /** One read per source, in the order given; reference-stable while nothing changed. */
  readonly reads: readonly SourceRead[];
  /** Read one source again (a conditional request for a GitHub tree, free when nothing changed). */
  readonly refetch: (name: string) => void;
}

/** One plugin a grid can show: the entry, and where it came from. */
export interface CatalogEntry {
  readonly source: KnownMarketplace;
  readonly opened: OpenedMarketplace;
  readonly entry: MarketplaceEntry;
}

const NO_READS: readonly SourceRead[] = [];

/**
 * Read every source in `marketplaces` independently.
 *
 * @example
 * ```tsx
 * const { marketplaces } = useMarketplaces();
 * const { reads, refetch } = useMarketplaceCatalog(marketplaces);
 * const entries = useMemo(() => catalogEntries(reads), [reads]);
 * ```
 */
export function useMarketplaceCatalog(
  marketplaces: readonly KnownMarketplace[],
  options: UseMarketplaceCatalogOptions = {},
): UseMarketplaceCatalogReturn {
  const stigmer = useStigmer();
  const { fetchImpl } = options;
  const storeRef = useRef<MarketplaceCatalogStore | null>(null);
  if (storeRef.current === null) storeRef.current = new MarketplaceCatalogStore();
  const store = storeRef.current;

  const open = useCallback<OpenSource>(
    (source: MarketplaceSource) => openMarketplaceSource(source, stigmer, fetchImpl ? { fetchImpl } : {}),
    [stigmer, fetchImpl],
  );

  useEffect(() => {
    store.sync(marketplaces, open);
  }, [store, marketplaces, open]);

  const reads = useSyncExternalStore(store.subscribe, store.getSnapshot, () => NO_READS);
  const refetch = useCallback((name: string) => store.refetch(name), [store]);

  return useMemo(() => ({ reads, refetch }), [reads, refetch]);
}

/** Every entry the ready sources offer, in source order then catalogue order. */
export function catalogEntries(reads: readonly SourceRead[]): readonly CatalogEntry[] {
  const entries: CatalogEntry[] = [];
  for (const read of reads) {
    if (read.state.kind !== "ready") continue;
    const { opened } = read.state;
    for (const entry of opened.marketplace.plugins) {
      entries.push({ source: read.marketplace, opened, entry });
    }
  }
  return entries;
}
