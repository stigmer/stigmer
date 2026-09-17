"use client";

import type { Marketplace, MarketplaceFinding } from "@stigmer/plugin-package";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { openMarketplaceSource } from "./sources/open.js";
import type { OpenedMarketplace } from "./sources/read.js";
import type { FetchImpl, MarketplaceSource } from "./sources/types.js";

/** Options for {@link useMarketplace}. */
export interface UseMarketplaceOptions {
  /** The HTTP client the marketplace hosts are read through; `globalThis.fetch` when absent. Tests inject a fake. */
  readonly fetchImpl?: FetchImpl;
}

/** Return value of {@link useMarketplace}. */
export interface UseMarketplaceReturn {
  /** The catalogue, or `null` while loading or on error. */
  readonly marketplace: Marketplace | null;
  /** Entries the reader dropped, each with its own sentence, as `stigmer marketplace show` lists them. */
  readonly warnings: readonly MarketplaceFinding[];
  /** The opened tree, kept for the install that follows; `null` until read. */
  readonly opened: OpenedMarketplace | null;
  /** `true` while the tree is being listed and its marketplace file read. */
  readonly isLoading: boolean;
  /** The source's or the reader's refusal, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-list the tree (a conditional request, free when nothing changed). */
  readonly refetch: () => void;
}

const NO_WARNINGS: readonly MarketplaceFinding[] = [];

/**
 * Data hook that opens a marketplace source and reads its catalogue.
 *
 * A GitHub source is listed once through the Trees API and read at the
 * commit the listing resolved to; the official catalogue is read from the
 * npm CDN at the server's version. Pass `null` to skip (stable no-op).
 * The `error` carries a sentence the component renders as it is: a
 * repository that is not public, a development server with no published
 * catalogue, a tree the reader refuses.
 *
 * @example
 * ```tsx
 * const { marketplace, warnings, isLoading, error } = useMarketplace({ type: "github", repo: "cursor/plugins" });
 * ```
 */
export function useMarketplace(source: MarketplaceSource | null, options: UseMarketplaceOptions = {}): UseMarketplaceReturn {
  const stigmer = useStigmer();
  const { fetchImpl } = options;
  const sourceKey = source === null ? null : source.type === "official" ? "official" : `${source.repo}@${source.ref ?? ""}`;

  const { data: opened, isLoading, error, refetch } = useFetch(
    source ? () => openMarketplaceSource(source, stigmer, fetchImpl ? { fetchImpl } : {}) : null,
    // The source is identified by its key so a fresh object literal with the same fields does not refetch.
    [sourceKey, stigmer, fetchImpl],
    null,
  );

  return {
    marketplace: opened?.marketplace ?? null,
    warnings: opened?.warnings ?? NO_WARNINGS,
    opened,
    isLoading,
    error,
    refetch,
  };
}
