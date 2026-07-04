"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toError } from "../internal/toError.js";
import type { WorkspaceEntry } from "./useWorkspaceEntries.js";
import type {
  WorkspaceContentMatch,
  WorkspaceContentSearcher,
} from "./WorkspaceContentSearcher.js";

/** Default debounce for content-search query changes — matches `useResourceSearch`. */
const DEFAULT_DEBOUNCE_MS = 300;

/**
 * Minimum query length before a disk search fires. Content search hits the
 * filesystem on every query (unlike the cached filename search), so a
 * single-character query would scan the whole tree for a near-useless result.
 * Two characters is a gentle, documented floor — not an arbitrary limit.
 */
const DEFAULT_MIN_LENGTH = 2;

/** Options for {@link useWorkspaceContentSearch}. */
export interface UseWorkspaceContentSearchOptions {
  /** All workspace entries to search across. */
  readonly entries: readonly WorkspaceEntry[];
  /** Platform-injected content searcher. `undefined` → content search is unavailable. */
  readonly searcher: WorkspaceContentSearcher | undefined;
  /** Current search query. Trimmed; below {@link minLength} yields no search. */
  readonly query: string;
  /** Debounce delay for query changes in milliseconds. @default 300 */
  readonly debounceMs?: number;
  /** Minimum trimmed query length before a search runs. @default 2 */
  readonly minLength?: number;
}

/** Content-search hits (and per-entry status) for one workspace entry. */
export interface WorkspaceContentSearchGroup {
  /** The workspace entry these matches belong to. */
  readonly entry: WorkspaceEntry;
  /** Line-level matches within this entry, backend-ordered (path, then line). */
  readonly matches: readonly WorkspaceContentMatch[];
  /** `true` when this entry's search was capped (more matches exist than shown). */
  readonly truncated: boolean;
  /** Search error for this entry, if any (isolated — other entries still resolve). */
  readonly error: Error | null;
}

/** Return value of {@link useWorkspaceContentSearch}. */
export interface UseWorkspaceContentSearchReturn {
  /** Entries with something to show (matches, an error, or a truncation notice). */
  readonly groups: readonly WorkspaceContentSearchGroup[];
  /** Total matches across all groups (for a "showing N of M" affordance). */
  readonly totalMatches: number;
  /** `true` during the first search of a query with no prior results to show. */
  readonly isLoading: boolean;
  /** `true` while a new query loads *over* previously-shown results (no blank flash). */
  readonly isRefetching: boolean;
  /** `true` when no substrate can be searched (no searcher, or every entry unsupported). */
  readonly isUnsupported: boolean;
  /** First per-entry error, for a top-level fallback message. `null` when none. */
  readonly error: Error | null;
}

/** Settled per-entry result held between query changes (never a "loading" state). */
type EntryResult =
  | { readonly status: "ready"; readonly matches: readonly WorkspaceContentMatch[]; readonly truncated: boolean }
  | { readonly status: "error"; readonly error: Error }
  | { readonly status: "unsupported" };

const EMPTY_GROUPS: readonly WorkspaceContentSearchGroup[] = [];

/**
 * Behavior hook powering workspace-wide content (text) search.
 *
 * The text-grep sibling of
 * {@link import("./useWorkspaceFileSearch.js").useWorkspaceFileSearch}: it keeps
 * that hook's per-entry aggregation, error isolation, and generation guard, and
 * adds the platform's canonical debounce idiom from `useResourceSearch`
 * (`query`/`debouncedQuery` + `setTimeout`). The key difference is that the
 * debounced query is part of the *fetch* — each keystroke hits disk via the
 * injected {@link WorkspaceContentSearcher}, uncached — so a `minLength` guard
 * and a debounce protect the filesystem.
 *
 * Prior results stay visible while a new debounced query loads (`isRefetching`
 * true, results unchanged); only the very first search with nothing to show
 * flips `isLoading`. This avoids a per-keystroke blank flash the cached filename
 * search never had.
 *
 * @example
 * ```tsx
 * const { groups, totalMatches, isRefetching } = useWorkspaceContentSearch({
 *   entries: workspace.entries,
 *   searcher: workspaceContentSearcher,
 *   query,
 * });
 * ```
 */
export function useWorkspaceContentSearch({
  entries,
  searcher,
  query,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  minLength = DEFAULT_MIN_LENGTH,
}: UseWorkspaceContentSearchOptions): UseWorkspaceContentSearchReturn {
  // Settled results per entry, keyed by entry id. Retained across query changes
  // and only swapped wholesale when a new generation fully resolves — so a
  // reload never blanks what the user is already reading.
  const [results, setResults] = useState<Record<string, EntryResult>>({});
  const [pending, setPending] = useState(false);

  // Debounce the query into the fetch key (the `useResourceSearch` idiom).
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), debounceMs);
    return () => clearTimeout(timer);
  }, [query, debounceMs]);

  // Latest entries read inside the effect without widening its dependency to the
  // (possibly per-render) array identity — the effect keys on the id set instead.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const entriesKey = entries.map((entry) => entry.id).join("\u0000");

  // Ignore resolutions from a superseded run (id set, searcher, or query changed).
  const generationRef = useRef(0);

  const effectiveQuery = debouncedQuery.trim();
  const belowMinLength = effectiveQuery.length < minLength;

  useEffect(() => {
    // No searcher or a too-short query: clear results, nothing in flight. (An
    // in-flight generation is abandoned via the bumped ref.)
    if (!searcher || belowMinLength) {
      generationRef.current += 1;
      setResults({});
      setPending(false);
      return;
    }

    const currentEntries = entriesRef.current;
    const generation = ++generationRef.current;
    setPending(true);

    Promise.all(
      currentEntries.map(async (entry): Promise<[string, EntryResult]> => {
        try {
          const result = await searcher(entry, effectiveQuery);
          if (result === null) return [entry.id, { status: "unsupported" }];
          return [
            entry.id,
            { status: "ready", matches: result.matches, truncated: result.truncated },
          ];
        } catch (err) {
          return [entry.id, { status: "error", error: toError(err) }];
        }
      }),
    ).then((settled) => {
      // A newer generation started while this batch was in flight — drop it so
      // stale results never overwrite fresher ones (or clobber a cleared state).
      if (generationRef.current !== generation) return;
      const next: Record<string, EntryResult> = {};
      for (const [id, res] of settled) next[id] = res;
      setResults(next);
      setPending(false);
    });
  }, [entriesKey, searcher, effectiveQuery, belowMinLength]);

  return useMemo<UseWorkspaceContentSearchReturn>(() => {
    if (!searcher) {
      return {
        groups: EMPTY_GROUPS,
        totalMatches: 0,
        isLoading: false,
        isRefetching: false,
        isUnsupported: true,
        error: null,
      };
    }

    const groups: WorkspaceContentSearchGroup[] = [];
    let totalMatches = 0;
    let firstError: Error | null = null;
    let unsupportedCount = 0;
    let settledCount = 0;

    for (const entry of entries) {
      const state = results[entry.id];
      if (!state) continue;
      settledCount += 1;

      if (state.status === "unsupported") {
        unsupportedCount += 1;
        continue;
      }
      if (state.status === "error") {
        if (!firstError) firstError = state.error;
        groups.push({ entry, matches: [], truncated: false, error: state.error });
        continue;
      }

      totalMatches += state.matches.length;
      // Worth showing only when it carries matches or a truncation notice.
      if (state.matches.length > 0 || state.truncated) {
        groups.push({
          entry,
          matches: state.matches,
          truncated: state.truncated,
          error: null,
        });
      }
    }

    const hasPriorResults = settledCount > 0;
    const isUnsupported =
      entries.length > 0 && unsupportedCount === entries.length;

    return {
      groups,
      totalMatches,
      // First search (nothing settled yet) blanks; a reload over existing
      // results keeps them visible and signals `isRefetching` instead.
      isLoading: pending && !hasPriorResults,
      isRefetching: pending && hasPriorResults,
      isUnsupported,
      error: firstError,
    };
  }, [entries, results, pending, searcher]);
}
