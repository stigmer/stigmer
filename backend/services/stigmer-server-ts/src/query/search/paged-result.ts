/**
 * Paged search result — ports
 * pkg/query/search/valueobject/search_paged_result.go: the page of
 * SearchResult projections plus the counts the response carries.
 * totalPages = ceil(totalCount / pageSize), 0 when pageSize is 0 (the
 * EmptyResult shape). Negative totals/page sizes are internal-contract
 * violations and throw, as Go's constructor errors.
 *
 * Go defensively copies on construction AND on every accessor; here the
 * readonly types carry the same do-not-mutate contract without the
 * per-call copies (TS's compile-time twin of Go's runtime discipline).
 */
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

export interface SearchPagedResult {
  readonly results: readonly SearchResult[];
  /** Total matches per kind NAME string — totals, not page counts. */
  readonly countsByKind: Readonly<Record<string, number>>;
  readonly totalCount: number;
  readonly totalPages: number;
}

const EMPTY_RESULT: SearchPagedResult = {
  results: [],
  countsByKind: {},
  totalCount: 0,
  totalPages: 0,
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
  pageSize: number,
): SearchPagedResult {
  if (totalCount < 0) {
    throw new Error(`totalCount cannot be negative: ${totalCount}`);
  }
  if (pageSize < 0) {
    throw new Error(`pageSize cannot be negative: ${pageSize}`);
  }
  return {
    results,
    countsByKind,
    totalCount,
    totalPages: pageSize > 0 ? Math.ceil(totalCount / pageSize) : 0,
  };
}
