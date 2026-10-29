/**
 * Paged search result: the page of
 * SearchResult projections plus the counts the response carries, and the
 * engine's match total, which says whether a page follows (the response
 * carries no total: a list says whether there is more, not how many). A
 * negative total is an internal-contract violation and throws.
 *
 * The readonly types carry the do-not-mutate contract at compile time, so
 * neither construction nor the accessors copy.
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

/** The shared empty page. */
export function emptyResult(): SearchPagedResult {
  return EMPTY_RESULT;
}

/** A page from its results, per-kind counts and match total. */
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
