/**
 * Pins the sqlite driver's engine-specific search half (fts5.ts) against
 * Go's sqlite_search_query_store_test.go tables — MATCH rendering and
 * bm25 normalization, case-for-case — recomposed for the DD-009 seam:
 * the table inputs pass through the search service's engine-neutral
 * tokenization (goTrimSpace/goFields) so every pinned OUTPUT byte stays
 * identical to the pre-redraw escapeFTS5Query's. Also pins the driver's
 * querySearchIndex read directly (structured terms in, wire-ready scores
 * out) — coverage the pre-redraw layering could only exercise through
 * the search service.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { goFields, goTrimSpace } from "../../../gocompat/trim.js";
import type { SearchIndexEntry } from "../../interface.js";
import { normalizeBm25Score, renderFts5MatchExpression } from "../fts5.js";
import { tempStore, type TempStore } from "./support.js";

/** The service's tokenization composed with the driver's rendering —
 *  the exact pipeline a raw query traverses since the seam redraw. */
function renderFromRawQuery(query: string): string {
  return renderFts5MatchExpression(goFields(goTrimSpace(query)));
}

describe("renderFts5MatchExpression (Go's escaping table, case-for-case)", () => {
  const cases: Array<[name: string, input: string, expected: string]> = [
    ["empty query", "", ""],
    ["single word", "kubernetes", `"kubernetes"*`],
    ["multiple words", "kubernetes deployment", `"kubernetes" "deployment"`],
    ["whitespace trimmed", "  hello  ", `"hello"*`],
    ["AND treated as literal", "foo AND bar", `"foo" "AND" "bar"`],
    ["OR treated as literal", "foo OR bar", `"foo" "OR" "bar"`],
    ["NOT treated as literal", "foo NOT bar", `"foo" "NOT" "bar"`],
    ["NEAR treated as literal", "foo NEAR bar", `"foo" "NEAR" "bar"`],
    ["colon in single token", "server:skill-creator", `"server:skill-creator"*`],
    ["colon with simple term", "name:kubernetes", `"name:kubernetes"*`],
    [
      "colon in multi-word query",
      "find server:something here",
      `"find" "server:something" "here"`,
    ],
    ["dash in token", "mcp-server", `"mcp-server"*`],
    ["leading dash", "-excluded", `"-excluded"*`],
    ["dash in multi-word", "mcp-server deployment", `"mcp-server" "deployment"`],
    ["asterisk in token", "kube*", `"kube*"*`],
    ["parentheses", "NEAR(a b)", `"NEAR(a" "b)"`],
    ["brackets", "test[0]", `"test[0]"*`],
    ["caret", "^boost", `"^boost"*`],
    ["embedded quotes stripped", `foo"bar`, `"foobar"*`],
    ["only quotes", `"""`, ""],
    [
      "mixed specials multi-word",
      `server:x mcp-server kube*`,
      `"server:x" "mcp-server" "kube*"`,
    ],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(renderFromRawQuery(input)).toBe(expected);
    });
  }

  it("the prefix decision counts terms AFTER sanitization (Go's order)", () => {
    // Two input terms, one sanitizes away — the survivor is a SINGLE
    // term and keeps prefix matching.
    expect(renderFts5MatchExpression(["foo", `"""`])).toBe(`"foo"*`);
  });
});

describe("normalizeBm25Score (Go's table)", () => {
  const cases: Array<[bm25: number, min: number, max: number]> = [
    [0, 1.0, 1.0],
    [1.0, 1.0, 1.0],
    [-1.0, 0.8, 1.0],
    [-5.0, 0.4, 0.6],
    [-15.0, 0, 0.1],
  ];
  for (const [bm25, min, max] of cases) {
    it(`bm25 ${bm25} → [${min}, ${max}]`, () => {
      const score = normalizeBm25Score(bm25);
      expect(score).toBeGreaterThanOrEqual(min);
      expect(score).toBeLessThanOrEqual(max);
    });
  }
});

describe("querySearchIndex — the driver-level read contract", () => {
  let temp: TempStore;

  beforeEach(() => {
    temp = tempStore();
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  function entry(overrides: Partial<SearchIndexEntry>): SearchIndexEntry {
    return {
      name: "unnamed",
      description: "",
      tags: "",
      org: "acme",
      visibility: "visibility_private",
      createdAt: 1_700_000_000,
      ...overrides,
    };
  }

  it("search mode returns matching hits with wire-ready scores (0–1, higher = better)", async () => {
    await temp.store.upsertSearchIndex(
      ApiResourceKind.agent,
      "agt-1",
      entry({ name: "kubernetes helper", createdAt: 1_700_000_001 }),
    );
    await temp.store.upsertSearchIndex(
      ApiResourceKind.agent,
      "agt-2",
      entry({ name: "unrelated thing", createdAt: 1_700_000_002 }),
    );

    const result = await temp.store.querySearchIndex({
      kinds: ["agent"],
      terms: ["kubernetes"],
      orgFilter: "",
      crossOrgPublic: false,
      excludePublic: false,
      limit: 20,
      offset: 0,
    });

    expect(result.totalCount).toBe(1);
    expect(result.countsByKind).toEqual({ agent: 1 });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.resourceId).toBe("agt-1");
    expect(result.hits[0]?.score).toBeGreaterThan(0);
    expect(result.hits[0]?.score).toBeLessThanOrEqual(1);
  });

  it("a single term is a prefix match; multiple terms compose with AND", async () => {
    await temp.store.upsertSearchIndex(
      ApiResourceKind.agent,
      "agt-1",
      entry({ name: "kubernetes deployment helper" }),
    );

    const prefix = await temp.store.querySearchIndex({
      kinds: ["agent"],
      terms: ["kuber"],
      orgFilter: "",
      crossOrgPublic: false,
      excludePublic: false,
      limit: 20,
      offset: 0,
    });
    expect(prefix.totalCount).toBe(1);

    const bothMatch = await temp.store.querySearchIndex({
      kinds: ["agent"],
      terms: ["kubernetes", "deployment"],
      orgFilter: "",
      crossOrgPublic: false,
      excludePublic: false,
      limit: 20,
      offset: 0,
    });
    expect(bothMatch.totalCount).toBe(1);

    const oneMisses = await temp.store.querySearchIndex({
      kinds: ["agent"],
      terms: ["kubernetes", "absent"],
      orgFilter: "",
      crossOrgPublic: false,
      excludePublic: false,
      limit: 20,
      offset: 0,
    });
    expect(oneMisses.totalCount).toBe(0);
    expect(oneMisses.hits).toEqual([]);
  });

  it("list mode (terms undefined) orders newest first with score exactly 1.0", async () => {
    await temp.store.upsertSearchIndex(
      ApiResourceKind.agent,
      "agt-old",
      entry({ name: "older", createdAt: 1_700_000_001 }),
    );
    await temp.store.upsertSearchIndex(
      ApiResourceKind.agent,
      "agt-new",
      entry({ name: "newer", createdAt: 1_700_000_002 }),
    );

    const result = await temp.store.querySearchIndex({
      kinds: ["agent"],
      terms: undefined,
      orgFilter: "",
      crossOrgPublic: false,
      excludePublic: false,
      limit: 20,
      offset: 0,
    });

    expect(result.hits.map((hit) => hit.resourceId)).toEqual([
      "agt-new",
      "agt-old",
    ]);
    for (const hit of result.hits) {
      expect(hit.score).toBe(1.0);
    }
  });
});
