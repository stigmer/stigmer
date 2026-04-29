"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY_PREFIX = "stigmer:recent-workspaces:";
const MAX_RECENT = 8;

/** A recently used or favorited workspace path for a specific runner. */
export interface RecentWorkspace {
  /** Absolute path on the runner's filesystem. */
  readonly path: string;
  /** Whether the user pinned this path as a favorite. */
  readonly pinned: boolean;
  /** Epoch ms when this path was last selected. */
  readonly lastUsed: number;
}

/** Return value of {@link useRecentWorkspaces}. */
export interface UseRecentWorkspacesReturn {
  /** Recent paths sorted: pinned first, then by recency. */
  readonly entries: readonly RecentWorkspace[];
  /** Record a path selection (adds or bumps it in the list). */
  readonly recordSelection: (path: string) => void;
  /** Toggle the pinned state of a path. */
  readonly togglePin: (path: string) => void;
  /** Remove a path from the recent list. */
  readonly remove: (path: string) => void;
}

function storageKey(runnerId: string): string {
  return `${STORAGE_KEY_PREFIX}${runnerId}`;
}

function readEntries(runnerId: string): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(storageKey(runnerId));
    if (!raw) return [];
    return JSON.parse(raw) as RecentWorkspace[];
  } catch {
    return [];
  }
}

function writeEntries(runnerId: string, entries: RecentWorkspace[]): void {
  try {
    localStorage.setItem(storageKey(runnerId), JSON.stringify(entries));
  } catch {
    // localStorage full or unavailable — silently degrade.
  }
}

function sortEntries(entries: RecentWorkspace[]): RecentWorkspace[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.lastUsed - a.lastUsed;
  });
}

const listeners = new Set<() => void>();
let snapshotVersion = 0;

function notifyListeners(): void {
  snapshotVersion++;
  for (const fn of listeners) fn();
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/**
 * Manages recently used workspace paths for a specific runner,
 * persisted in `localStorage`.
 *
 * Entries are keyed by `runner_id` so each runner maintains its own
 * history. Pinned paths appear first, then by most-recently-used.
 *
 * @param runnerId - Runner to scope the history to. When `null`, returns empty.
 */
export function useRecentWorkspaces(
  runnerId: string | null,
): UseRecentWorkspacesReturn {
  const entries = useSyncExternalStore(
    subscribe,
    () => {
      void snapshotVersion;
      return runnerId ? sortEntries(readEntries(runnerId)) : [];
    },
    () => [],
  );

  const recordSelection = useCallback(
    (path: string) => {
      if (!runnerId) return;
      const existing = readEntries(runnerId);
      const idx = existing.findIndex((e) => e.path === path);
      const now = Date.now();

      let updated: RecentWorkspace[];
      if (idx >= 0) {
        updated = [...existing];
        updated[idx] = { ...updated[idx], lastUsed: now };
      } else {
        updated = [{ path, pinned: false, lastUsed: now }, ...existing];
      }

      if (updated.length > MAX_RECENT) {
        const unpinned = updated.filter((e) => !e.pinned);
        if (unpinned.length > 0) {
          unpinned.sort((a, b) => a.lastUsed - b.lastUsed);
          const oldest = unpinned[0];
          updated = updated.filter((e) => e !== oldest);
        }
      }

      writeEntries(runnerId, updated);
      notifyListeners();
    },
    [runnerId],
  );

  const togglePin = useCallback(
    (path: string) => {
      if (!runnerId) return;
      const existing = readEntries(runnerId);
      const idx = existing.findIndex((e) => e.path === path);
      if (idx < 0) return;
      const updated = [...existing];
      updated[idx] = { ...updated[idx], pinned: !updated[idx].pinned };
      writeEntries(runnerId, updated);
      notifyListeners();
    },
    [runnerId],
  );

  const remove = useCallback(
    (path: string) => {
      if (!runnerId) return;
      const updated = readEntries(runnerId).filter((e) => e.path !== path);
      writeEntries(runnerId, updated);
      notifyListeners();
    },
    [runnerId],
  );

  return { entries, recordSelection, togglePin, remove };
}
