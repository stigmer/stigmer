/**
 * Pins the sqlite driver's engine-specific search half (fts5.ts) against
 * Go's sqlite_search_query_store_test.go tables — MATCH rendering and
 * bm25 normalization, case-for-case — recomposed for the DD-009 seam:
 * the table inputs pass through the search service's engine-neutral
 * tokenization (goTrimSpace/goFields) so every pinned OUTPUT byte stays
 * identical to the pre-redraw escapeFTS5Query's. The driver-level
 * querySearchIndex read coverage moved to the shared contract suite
 * (../../__tests__/store-contract.ts) with the T01 D-4 extraction — its
 * semantics are engine-neutral and both drivers must satisfy them.
 */
import { describe, expect, it } from "vitest";

import { goFields, goTrimSpace } from "../../../gocompat/trim.js";
import { normalizeBm25Score, renderFts5MatchExpression } from "../fts5.js";

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
