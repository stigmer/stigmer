/**
 * Manages a per-user list of recently used task kinds.
 *
 * Persisted to localStorage so recents survive page reloads and
 * sessions. Scoped by a storage key prefix to allow per-workflow
 * or per-project isolation if needed in the future.
 *
 * The store is intentionally simple and synchronous — localStorage
 * access is fast enough for the 5-item list we maintain.
 */

const DEFAULT_STORAGE_KEY = "stigmer:picker:recent-kinds";
const MAX_RECENTS = 5;

/**
 * A single recently-used task kind entry with a usage timestamp.
 */
export interface RecentKindEntry {
  readonly kind: string;
  readonly timestamp: number;
}

/**
 * Retrieves the list of recently used task kinds, ordered by most recent first.
 *
 * Returns an empty array if localStorage is unavailable or contains
 * invalid data.
 */
export function getRecentKinds(storageKey = DEFAULT_STORAGE_KEY): readonly RecentKindEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(isValidEntry)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/**
 * Records a task kind as recently used.
 *
 * If the kind already exists in the list, it is moved to the front
 * (most recent). The list is capped at {@link MAX_RECENTS} entries.
 */
export function recordRecentKind(
  kind: string,
  storageKey = DEFAULT_STORAGE_KEY,
): void {
  try {
    const existing = getRecentKinds(storageKey).filter((e) => e.kind !== kind);
    const updated: RecentKindEntry[] = [
      { kind, timestamp: Date.now() },
      ...existing,
    ].slice(0, MAX_RECENTS);

    globalThis.localStorage?.setItem(storageKey, JSON.stringify(updated));
  } catch {
    // localStorage unavailable (SSR, private browsing quota exceeded)
  }
}

/**
 * Clears all recent kind entries. Useful for testing or user preference reset.
 */
export function clearRecentKinds(storageKey = DEFAULT_STORAGE_KEY): void {
  try {
    globalThis.localStorage?.removeItem(storageKey);
  } catch {
    // Silently ignore storage errors
  }
}

function isValidEntry(value: unknown): value is RecentKindEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "timestamp" in value &&
    typeof (value as RecentKindEntry).kind === "string" &&
    typeof (value as RecentKindEntry).timestamp === "number"
  );
}
