/**
 * Pins the paged-result value object against Go's
 * search_paged_result_test.go, less the page-count math the response no
 * longer carries: the results, counts and match total pass through, a
 * negative total is refused, and EmptyResult is the all-zero shape.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SearchResultSchema } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

import { emptyResult, newSearchPagedResult } from "../paged-result.js";

describe("newSearchPagedResult", () => {
  it("carries results, counts, and the match total through", () => {
    const results = [create(SearchResultSchema, { id: "agt_1" })];
    const paged = newSearchPagedResult(results, { agent: 5 }, 5);
    expect(paged.results).toHaveLength(1);
    expect(paged.countsByKind).toEqual({ agent: 5 });
    expect(paged.totalCount).toBe(5);
  });

  it("rejects a negative total with Go's message", () => {
    expect(() => newSearchPagedResult([], {}, -1)).toThrowError(
      "totalCount cannot be negative: -1",
    );
  });
});

describe("emptyResult", () => {
  it("is the all-zero shape", () => {
    const empty = emptyResult();
    expect(empty.results).toEqual([]);
    expect(empty.countsByKind).toEqual({});
    expect(empty.totalCount).toBe(0);
  });
});
