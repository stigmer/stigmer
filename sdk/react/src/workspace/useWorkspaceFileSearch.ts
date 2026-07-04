"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toError } from "../internal/toError.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type { WorkspaceFileLister } from "./WorkspaceFileLister.js";
import { loadEntryFiles, type WorkspaceListing } from "./workspaceListingCache.js";
import { matchWorkspaceFiles, type WorkspaceFileMatch } from "./matchWorkspaceFiles.js";

/** Options for {@link useWorkspaceFileSearch}. */
export interface UseWorkspaceFileSearchOptions {
  /** All workspace entries to search across. */
  readonly entries: readonly WorkspaceEntry[];
  /** Platform-injected file lister. `undefined` → nothing is searchable. */
  readonly lister: WorkspaceFileLister | undefined;
  /** Current search query. Empty/whitespace yields no matches (search shows a hint). */
  readonly query: string;
}

/** Matches (and per-entry status) for one workspace entry. */
export interface WorkspaceFileSearchGroup {
  /** The workspace entry these matches belong to. */
  readonly entry: WorkspaceEntry;
  /** Ranked matches within this entry, best-first. */
  readonly matches: readonly WorkspaceFileMatch[];
  /** `true` when this entry's listing was truncated (repository too large). */
  readonly truncated: boolean;
  /** Listing error for this entry, if any (isolated — other entries still resolve). */
  readonly error: Error | null;
}

/** Return value of {@link useWorkspaceFileSearch}. */
export interface UseWorkspaceFileSearchReturn {
  /** Entries with something to show (matches, an error, or a truncation notice). */
  readonly groups: readonly WorkspaceFileSearchGroup[];
  /** Total matches across all groups (for a "showing N of M" affordance). */
  readonly totalMatches: number;
  /** `true` while any entry's listing is still loading. */
  readonly isLoading: boolean;
  /** `true` when no substrate can be searched (no lister, or every entry unsupported). */
  readonly isUnsupported: boolean;
  /** First per-entry error, for a top-level fallback message. `null` when none. */
  readonly error: Error | null;
}

/** Per-entry listing status held while the hook loads across entries. */
interface EntryListingState {
  readonly status: "loading" | "ready" | "error" | "unsupported";
  readonly listing?: WorkspaceListing;
  readonly error?: Error;
}

const EMPTY_GROUPS: readonly WorkspaceFileSearchGroup[] = [];

/**
 * Behavior hook powering workspace-wide filename/path search.
 *
 * Loads each entry's listing through the shared
 * {@link loadEntryFiles} cache (warm from
 * Files browsing → usually free), then ranks matches per entry with the pure
 * {@link matchWorkspaceFiles}. Fetching is keyed by the set of entry ids, so a
 * query change re-ranks the already-loaded listings without re-fetching. Errors
 * are isolated per entry (one failing repo never blanks the rest), and a stale
 * generation's late resolutions are ignored.
 *
 * Meant to be consumed by a component mounted only while Search is active
 * (`WorkspaceFileSearch`), so the Files view incurs no search fetching.
 *
 * @example
 * ```tsx
 * const { groups, totalMatches, isLoading } = useWorkspaceFileSearch({
 *   entries: workspace.entries,
 *   lister: workspaceFileLister,
 *   query,
 * });
 * ```
 */
export function useWorkspaceFileSearch({
  entries,
  lister,
  query,
}: UseWorkspaceFileSearchOptions): UseWorkspaceFileSearchReturn {
  const [states, setStates] = useState<Record<string, EntryListingState>>({});

  // Latest entries read inside the effect without widening its dependency to the
  // (possibly per-render) array identity — the effect keys on the id set instead.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const entriesKey = entries.map((entry) => entry.id).join("\u0000");

  // Ignore resolutions from a superseded entry set (id set or lister changed).
  const generationRef = useRef(0);

  useEffect(() => {
    if (!lister) {
      setStates({});
      return;
    }

    const currentEntries = entriesRef.current;
    const generation = ++generationRef.current;

    // Seed loading for not-yet-known entries; drop states for removed ones.
    setStates((prev) => {
      const next: Record<string, EntryListingState> = {};
      for (const entry of currentEntries) {
        next[entry.id] = prev[entry.id] ?? { status: "loading" };
      }
      return next;
    });

    for (const entry of currentEntries) {
      loadEntryFiles(entry, lister)
        .then((listing) => {
          if (generationRef.current !== generation) return;
          setStates((prev) => ({
            ...prev,
            [entry.id]:
              listing === null
                ? { status: "unsupported" }
                : { status: "ready", listing },
          }));
        })
        .catch((err) => {
          if (generationRef.current !== generation) return;
          setStates((prev) => ({
            ...prev,
            [entry.id]: { status: "error", error: toError(err) },
          }));
        });
    }
  }, [entriesKey, lister]);

  return useMemo<UseWorkspaceFileSearchReturn>(() => {
    if (!lister) {
      return {
        groups: EMPTY_GROUPS,
        totalMatches: 0,
        isLoading: false,
        isUnsupported: true,
        error: null,
      };
    }

    const groups: WorkspaceFileSearchGroup[] = [];
    let totalMatches = 0;
    let isLoading = false;
    let firstError: Error | null = null;
    let unsupportedCount = 0;

    for (const entry of entries) {
      const state = states[entry.id];

      if (!state || state.status === "loading") {
        isLoading = true;
        continue;
      }
      if (state.status === "unsupported") {
        unsupportedCount += 1;
        continue;
      }

      const error = state.status === "error" ? state.error ?? null : null;
      if (error && !firstError) firstError = error;

      const truncated = state.listing?.truncated ?? false;
      const matches = state.listing
        ? matchWorkspaceFiles(state.listing.files, query)
        : [];
      totalMatches += matches.length;

      // A group is worth showing only when it carries matches, an error, or a
      // truncation notice — otherwise it is silent.
      if (matches.length > 0 || error || truncated) {
        groups.push({ entry, matches, truncated, error });
      }
    }

    const isUnsupported =
      entries.length > 0 && unsupportedCount === entries.length;

    return { groups, totalMatches, isLoading, isUnsupported, error: firstError };
  }, [entries, states, query, lister]);
}
