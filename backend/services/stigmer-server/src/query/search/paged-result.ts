/**
 * Paged search result — ports
 * pkg/query/search/valueobject/search_paged_result.go: the page of
 * SearchResult projections plus the counts the response carries, and the
 * engine's match total, which says whether a page follows (the response
 * carries no total: a list says whether there is more, not how many). A
 * negative total is an internal-contract violation and throws, as Go's
 * constructor errors.
 *
 * Go defensively copies on construction AND on every accessor; here the
 * readonly types carry the same do-not-mutate contract without the
 * per-call copies (TS's compile-time twin of Go's runtime discipline).
 */
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

export interface SearchPagedResult {
  readonly results: readonly SearchResult[];
  /** Total matches per kind NAME string — totals, not page counts. */
  readonly countsByKind: Readonly<Record<string, number>>;
  /** Every match across the effective kinds; never on the wire. */
  readonly totalCount: number;
}

const EMPTY_RESULT: SearchPagedResult = {
  results: [],
  countsByKind: {},
  totalCount: 0,
};

/** Go EmptyResult(): the shared empty page. */
export function emptyResult(): SearchPagedResult {
  return EMPTY_RESULT;
}

/** Go NewSearchPagedResult. */
export function newSearchPagedResult(
  results: readonly SearchResult[],
  countsByKind: Readonly<Record<string, number>>,
  totalCount: number,
): SearchPagedResult {
  if (totalCount < 0) {
    throw new Error(`totalCount cannot be negative: ${totalCount}`);
  }
  return { results, countsByKind, totalCount };
}
