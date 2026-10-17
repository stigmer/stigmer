"use client";

/**
 * Previous / next paging over a list whose RPC pages by `page_token` /
 * `next_page_token`, for a view that shows one page at a time (a table
 * with a pager) rather than an accumulating "Load more" list
 * ({@link useCursorPages}).
 *
 * A token names the position after a page, so "previous" is the token
 * that read the page before: the hook keeps the tokens of the pages
 * visited as a stack, pushing the shown page's `nextPageToken` on "next"
 * and popping on "previous". Pages carry no total, so the view knows only
 * whether a page follows (`hasNext`) and how far in it is (`pageNumber`).
 *
 * The list's identity is `deps`: any change starts again from the first
 * page. `refetchKey` re-reads the current page in place (after an
 * out-of-band mutation) without moving it.
 *
 * @internal Not part of the public `@stigmer/react-sdk` API.
 */
import { type DependencyList, useCallback, useMemo, useState } from "react";
import type { CursorPage } from "./useCursorPages.js";
import { useFetch } from "./useFetch.js";

/** Return value of {@link useTokenPages}. */
export interface UseTokenPagesReturn<T, P extends CursorPage<T> = CursorPage<T>> {
  /** The shown page's entries. Empty while the first page loads. */
  readonly entries: readonly T[];
  /** The shown page as the server answered it, or `null` before it loads. */
  readonly page: P | null;
  /** 1 on the first page, one more for each "next". */
  readonly pageNumber: number;
  /** `true` when the server holds a page after the shown one. */
  readonly hasNext: boolean;
  /** `true` when a page was shown before this one. */
  readonly hasPrevious: boolean;
  /** Show the next page. No-op when none follows. */
  readonly next: () => void;
  /** Show the page before. No-op on the first page. */
  readonly previous: () => void;
  /** `true` only during the first load of the list. */
  readonly isLoading: boolean;
  /** `true` while a page is being read and the previous one is shown. */
  readonly isRefetching: boolean;
  /** Error from the last failed read, or `null`. */
  readonly error: Error | null;
  /** Re-read the shown page. */
  readonly refetch: () => void;
}

interface Navigation {
  readonly epoch: object;
  readonly stack: readonly string[];
}

const FIRST_PAGE: readonly string[] = [""];

/**
 * @param fetchPage Reads the page at a token (`""` for the first), or
 *                  `null` to stay idle.
 * @param deps      The list's identity: any change starts from page one.
 * @param refetchKey Changing it re-reads the shown page in place.
 */
export function useTokenPages<T, P extends CursorPage<T> = CursorPage<T>>(
  fetchPage: ((pageToken: string) => Promise<P>) | null,
  deps: DependencyList,
  refetchKey?: unknown,
): UseTokenPagesReturn<T, P> {
  // A new object whenever the list's identity changes: navigation stored
  // under an older epoch is read as the first page, so a changed filter
  // never reads with a token issued for the old one.
  const epoch = useMemo(() => ({}), deps);
  const [nav, setNav] = useState<Navigation>({ epoch, stack: FIRST_PAGE });
  const stack = nav.epoch === epoch ? nav.stack : FIRST_PAGE;
  const token = stack[stack.length - 1] ?? "";

  const { data: page, isLoading, isRefetching, error, refetch } = useFetch<P | null>(
    // Async, so a reader that throws before returning a promise lands as
    // the hook's error like a rejected read does.
    fetchPage === null ? null : async () => fetchPage(token),
    [epoch, token, refetchKey],
    null,
  );

  const nextToken = page?.nextPageToken ?? "";
  const next = useCallback(() => {
    if (nextToken === "") return;
    setNav({ epoch, stack: [...stack, nextToken] });
  }, [epoch, stack, nextToken]);
  const previous = useCallback(() => {
    if (stack.length <= 1) return;
    setNav({ epoch, stack: stack.slice(0, -1) });
  }, [epoch, stack]);

  return useMemo(
    () => ({
      entries: page?.entries ?? [],
      page,
      pageNumber: stack.length,
      hasNext: nextToken !== "",
      hasPrevious: stack.length > 1,
      next,
      previous,
      isLoading,
      isRefetching,
      error,
      refetch,
    }),
    [page, stack, nextToken, next, previous, isLoading, isRefetching, error, refetch],
  );
}
