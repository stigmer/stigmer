"use client";

/**
 * The cursor-list machinery shared by the data hooks whose RPC pages by
 * `page_token` / `next_page_token`: the first page rides {@link useFetch}
 * (stale-while-revalidate, refetch in place), older pages accumulate
 * through `loadMore`, and the whole reads newest first.
 *
 * The server's order is immutable (creation instant, then id), so a
 * refetched first page and the rows loaded before it merge by identity
 * alone, first page first: rows created since sit at the head, and a row
 * the refetch pushed off the first page is still held from the earlier
 * read, so nothing falls into a gap between the two. The continuation
 * token is always the tail's, never the refetched head's.
 *
 * A page may come back short or empty while still carrying a token: the
 * server stops after a bounded examination when a read scope refuses most
 * rows. `loadMore` follows such tokens up to {@link LOAD_MORE_MAX_PAGES}
 * reads so a press rarely adds nothing; past that the token is kept and
 * `hasMore` stays true, so the next press continues from there.
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
import { type DependencyList, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toError } from "./toError.js";
import { useFetch } from "./useFetch.js";

/** One page of a cursor-paged list response. */
export interface CursorPage<T> {
  readonly entries: readonly T[];
  /** Empty when the list ends with this page. */
  readonly nextPageToken: string;
}

/** Most pages one `loadMore` reads while they come back empty with a token. */
export const LOAD_MORE_MAX_PAGES = 5;

/** Return value of {@link useCursorPages}. */
export interface UseCursorPagesReturn<T, P extends CursorPage<T> = CursorPage<T>> {
  /** The first page, then every page loaded since, deduplicated by identity. */
  readonly items: readonly T[];
  /** The first page as the server answered it (for its other response fields). */
  readonly firstPage: P | null;
  /** `true` while the server holds rows beyond what is loaded. */
  readonly hasMore: boolean;
  /** Load the next page. No-op while one is loading or when nothing follows. */
  readonly loadMore: () => void;
  /** `true` while a `loadMore` read is in flight. */
  readonly isLoadingMore: boolean;
  /** Error from the last failed `loadMore`, or `null`. Cleared on retry. */
  readonly loadMoreError: Error | null;
  /** `true` only during the first load of the first page. */
  readonly isLoading: boolean;
  /** `true` while the first page refreshes in the background. */
  readonly isRefetching: boolean;
  /** Error from the last failed first-page read, or `null`. */
  readonly error: Error | null;
  /** Re-read the first page; loaded older pages stay. */
  readonly refetch: () => void;
}

interface Loaded<T> {
  readonly rows: readonly T[];
  readonly nextPageToken: string;
}

/**
 * @param fetchPage  Reads the page at a token (`""` for the first), or
 *                   `null` to stay idle.
 * @param deps       The list's identity: any change starts a fresh list.
 * @param identityOf A row's stable identity, for the merge.
 */
export function useCursorPages<T, P extends CursorPage<T> = CursorPage<T>>(
  fetchPage: ((pageToken: string) => Promise<P>) | null,
  deps: DependencyList,
  identityOf: (item: T) => string,
): UseCursorPagesReturn<T, P> {
  const {
    data: firstPage,
    isLoading,
    isRefetching,
    error,
    refetch,
  } = useFetch<P | null>(
    fetchPage === null ? null : () => fetchPage(""),
    deps,
    null,
  );

  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<Error | null>(null);
  const epochRef = useRef(0);
  const inFlightRef = useRef(false);

  useEffect(() => {
    epochRef.current += 1;
    inFlightRef.current = false;
    setLoaded(null);
    setIsLoadingMore(false);
    setLoadMoreError(null);
  }, deps);

  const items = useMemo(() => {
    const seen = new Set<string>();
    const merged: T[] = [];
    for (const item of [...(firstPage?.entries ?? []), ...(loaded?.rows ?? [])]) {
      const identity = identityOf(item);
      if (seen.has(identity)) continue;
      seen.add(identity);
      merged.push(item);
    }
    return merged;
    // identityOf is a pure projection: a new closure is not a data change.
  }, [firstPage, loaded]);

  const tailToken = loaded !== null ? loaded.nextPageToken : (firstPage?.nextPageToken ?? "");

  // loadMore reads the latest closure values through refs so its identity
  // stays stable across renders (a Button's onClick never re-binds).
  const fetchPageRef = useRef(fetchPage);
  fetchPageRef.current = fetchPage;
  const identityOfRef = useRef(identityOf);
  identityOfRef.current = identityOf;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const tailTokenRef = useRef(tailToken);
  tailTokenRef.current = tailToken;

  const loadMore = useCallback(() => {
    const read = fetchPageRef.current;
    const from = tailTokenRef.current;
    if (read === null || from === "" || inFlightRef.current) return;
    inFlightRef.current = true;
    const epoch = epochRef.current;
    const base = itemsRef.current;
    setIsLoadingMore(true);
    setLoadMoreError(null);

    void (async () => {
      try {
        const fetched: T[] = [];
        let pageToken = from;
        for (let pages = 0; pages < LOAD_MORE_MAX_PAGES; pages++) {
          const page = await read(pageToken);
          fetched.push(...page.entries);
          pageToken = page.nextPageToken;
          if (fetched.length > 0 || pageToken === "") break;
        }
        if (epochRef.current !== epoch) return;
        const identity = identityOfRef.current;
        const seen = new Set(base.map(identity));
        setLoaded({
          rows: [...base, ...fetched.filter((item) => !seen.has(identity(item)))],
          nextPageToken: pageToken,
        });
      } catch (err) {
        if (epochRef.current !== epoch) return;
        setLoadMoreError(toError(err));
      } finally {
        if (epochRef.current === epoch) {
          inFlightRef.current = false;
          setIsLoadingMore(false);
        }
      }
    })();
  }, []);

  return useMemo(
    () => ({
      items,
      firstPage,
      hasMore: tailToken !== "",
      loadMore,
      isLoadingMore,
      loadMoreError,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [items, firstPage, tailToken, loadMore, isLoadingMore, loadMoreError, isLoading, isRefetching, error, refetch],
  );
}
