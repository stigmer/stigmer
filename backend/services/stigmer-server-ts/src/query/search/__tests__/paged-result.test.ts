/**
 * Pins the paged-result math against Go's search_paged_result_test.go:
 * the totalPages ceiling table, the zero-pageSize arm, the negative-input
 * rejections, and the EmptyResult shape.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import { emptyResult, newSearchPagedResult } from "../paged-result.js";

describe("newSearchPagedResult", () => {
  it("carries results, counts, and totals through", () => {
    const results = [create(SearchResultSchema, { id: "agt_1" })];
    const paged = newSearchPagedResult(results, { agent: 5 }, 5, 20);
    expect(paged.results).toHaveLength(1);
    expect(paged.countsByKind).toEqual({ agent: 5 });
    expect(paged.totalCount).toBe(5);
    expect(paged.totalPages).toBe(1);
  });

  it("computes totalPages = ceil(totalCount / pageSize) (Go's table)", () => {
    const cases: Array<[total: number, size: number, pages: number]> = [
      [0, 20, 0],
      [1, 20, 1],
      [20, 20, 1],
      [21, 20, 2],
      [100, 20, 5],
      [101, 20, 6],
      [5, 2, 3],
    ];
    for (const [total, size, pages] of cases) {
      expect(newSearchPagedResult([], {}, total, size).totalPages).toBe(pages);
    }
  });

  it("pageSize 0 yields totalPages 0 (no division)", () => {
    expect(newSearchPagedResult([], {}, 10, 0).totalPages).toBe(0);
  });

  it("rejects negative totals and page sizes with Go's messages", () => {
    expect(() => newSearchPagedResult([], {}, -1, 20)).toThrowError(
      "totalCount cannot be negative: -1",
    );
    expect(() => newSearchPagedResult([], {}, 0, -2)).toThrowError(
      "pageSize cannot be negative: -2",
    );
  });
});

describe("emptyResult", () => {
  it("is the all-zero shape", () => {
    const empty = emptyResult();
    expect(empty.results).toEqual([]);
    expect(empty.countsByKind).toEqual({});
    expect(empty.totalCount).toBe(0);
    expect(empty.totalPages).toBe(0);
  });
});
