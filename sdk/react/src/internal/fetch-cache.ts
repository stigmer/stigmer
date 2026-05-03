/**
 * Lightweight keyed cache that survives React component remounts.
 *
 * Designed to sit above remount boundaries (via {@link FetchCacheProvider})
 * so hooks backed by `useFetch` can seed their initial state from a
 * previous mount's result instead of showing a loading skeleton.
 *
 * This is **not** a query library. It intentionally omits deduplication,
 * automatic background refetch, retry, devtools, and suspense integration.
 * `useFetch` already provides stale-while-revalidate semantics — this
 * class only gives it memory across mounts.
 *
 * @internal Consumed by `useFetch` via context; not part of the public
 * `@stigmer/react` API surface. The `FetchCacheProvider` component is
 * the public entry point.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheEntry {
  data: unknown;
  /** Epoch ms when the entry was written. */
  timestamp: number;
}

/** Configuration for {@link FetchCache}. */
export interface FetchCacheOptions {
  /**
   * Maximum number of entries before the oldest are evicted.
   * @default 100
   */
  readonly maxEntries?: number;
  /**
   * Time-to-live in milliseconds. Entries older than this are
   * treated as missing on read and lazily purged.
   * @default 300_000 (5 minutes)
   */
  readonly ttl?: number;
}

// ---------------------------------------------------------------------------
// FetchCache
// ---------------------------------------------------------------------------

export class FetchCache {
  private readonly _entries = new Map<string, CacheEntry>();
  private readonly _maxEntries: number;
  private readonly _ttl: number;

  constructor(options?: FetchCacheOptions) {
    this._maxEntries = options?.maxEntries ?? 100;
    this._ttl = options?.ttl ?? 5 * 60 * 1_000;
  }

  /**
   * Retrieve a cached value. Returns `undefined` when the key is
   * missing or the entry has expired.
   */
  get<T>(key: string): T | undefined {
    const entry = this._entries.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this._entries.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  /** `true` when a non-expired entry exists for `key`. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** Write (or overwrite) a cache entry and evict if over capacity. */
  set(key: string, data: unknown): void {
    // Delete first so the re-insertion moves `key` to the end of
    // the Map's insertion order — gives us LRU semantics for free.
    this._entries.delete(key);
    this._entries.set(key, { data, timestamp: Date.now() });
    this._evict();
  }

  /** Remove a single entry. */
  invalidate(key: string): void {
    this._entries.delete(key);
  }

  /**
   * Remove all entries whose key starts with `prefix`.
   *
   * Useful for bulk invalidation scoped to a resource type
   * (e.g. `invalidatePrefix("session:")` on logout).
   */
  invalidatePrefix(prefix: string): void {
    for (const key of this._entries.keys()) {
      if (key.startsWith(prefix)) {
        this._entries.delete(key);
      }
    }
  }

  /**
   * Fire-and-forget fetch that writes the result to the cache.
   * Errors are silently swallowed — the worst case is a cache miss.
   */
  prefetch<T>(key: string, fetchFn: () => Promise<T>): void {
    fetchFn().then(
      (data) => this.set(key, data),
      () => {
        /* intentional no-op */
      },
    );
  }

  /** Drop all entries. */
  clear(): void {
    this._entries.clear();
  }

  /** Number of live (non-expired) entries. Mainly useful in tests. */
  get size(): number {
    // Lazy purge expired entries on size read so the count is accurate.
    for (const [key, entry] of this._entries) {
      if (this._isExpired(entry)) this._entries.delete(key);
    }
    return this._entries.size;
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private _isExpired(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this._ttl;
  }

  /**
   * Evict the oldest entries (by insertion order) when the cache
   * exceeds `maxEntries`. Because `Map` preserves insertion order
   * and `set` always re-inserts at the tail, the iterator yields
   * entries from oldest to newest — giving us LRU eviction.
   */
  private _evict(): void {
    if (this._entries.size <= this._maxEntries) return;
    const excess = this._entries.size - this._maxEntries;
    const iter = this._entries.keys();
    for (let i = 0; i < excess; i++) {
      const { value: key, done } = iter.next();
      if (done) break;
      this._entries.delete(key);
    }
  }
}
