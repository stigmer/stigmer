"use client";

import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY_PREFIX = "stigmer:recent-workspaces:";
const MAX_RECENT = 8;

/** A recently used or favorited workspace path. */
export interface RecentWorkspace {
  /** Absolute path on the filesystem. */
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

function storageKey(scopeId: string): string {
  return `${STORAGE_KEY_PREFIX}${scopeId}`;
}

function readEntries(scopeId: string): RecentWorkspace[] {
  try {
    const raw = localStorage.getItem(storageKey(scopeId));
    if (!raw) return [];
    return JSON.parse(raw) as RecentWorkspace[];
  } catch {
    return [];
  }
}

function writeEntries(scopeId: string, entries: RecentWorkspace[]): void {
  try {
    localStorage.setItem(storageKey(scopeId), JSON.stringify(entries));
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

const EMPTY: readonly RecentWorkspace[] = [];

let cachedScopeId: string | null = null;
let cachedVersion = -1;
let cachedResult: readonly RecentWorkspace[] = EMPTY;

function getSnapshot(scopeId: string | null): readonly RecentWorkspace[] {
  if (!scopeId) return EMPTY;
  if (scopeId === cachedScopeId && snapshotVersion === cachedVersion) {
    return cachedResult;
  }
  cachedScopeId = scopeId;
  cachedVersion = snapshotVersion;
  cachedResult = sortEntries(readEntries(scopeId));
  return cachedResult;
}

/**
 * Manages recently used workspace paths, persisted in `localStorage`.
 *
 * Entries are keyed by `scopeId` (e.g. a session ID or machine identifier)
 * so each scope maintains its own history. Pinned paths appear first,
 * then by most-recently-used.
 *
 * @param scopeId - Scope to key the history to. When `null`, returns empty.
 */
export function useRecentWorkspaces(
  scopeId: string | null,
): UseRecentWorkspacesReturn {
  const entries = useSyncExternalStore(
    subscribe,
    () => getSnapshot(scopeId),
    () => EMPTY,
  );

  const recordSelection = useCallback(
    (path: string) => {
      if (!scopeId) return;
      const existing = readEntries(scopeId);
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

      writeEntries(scopeId, updated);
      notifyListeners();
    },
    [scopeId],
  );

  const togglePin = useCallback(
    (path: string) => {
      if (!scopeId) return;
      const existing = readEntries(scopeId);
      const idx = existing.findIndex((e) => e.path === path);
      if (idx < 0) return;
      const updated = [...existing];
      updated[idx] = { ...updated[idx], pinned: !updated[idx].pinned };
      writeEntries(scopeId, updated);
      notifyListeners();
    },
    [scopeId],
  );

  const remove = useCallback(
    (path: string) => {
      if (!scopeId) return;
      const updated = readEntries(scopeId).filter((e) => e.path !== path);
      writeEntries(scopeId, updated);
      notifyListeners();
    },
    [scopeId],
  );

  return { entries, recordSelection, togglePin, remove };
}
