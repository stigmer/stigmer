/**
 * Pins the Postgres driver's engine-specific search half (tsquery.ts) —
 * the fts5.test.ts counterpart. Rendering: the same engine-neutral term
 * inputs the sqlite tables use, with the OUTPUTS pinned in tsquery syntax
 * (quoted lexemes, explicit &, single-term :* prefix — sanitization strips
 * single quotes and backslashes, the characters that would escape a quoted
 * lexeme). Normalization: ts_rank is already higher-is-better, so the wire
 * mapping is a clamp to [0, 1].
 *
 * Pure-function tables — no database needed, always runs. The DB-backed
 * read semantics live in the shared contract suite; the driver-relative
 * ranking pin lives in store-contract.test.ts.
 */
import { describe, expect, it } from "vitest";

import { normalizeTsRankScore, renderTsQueryExpression } from "../tsquery.js";

describe("renderTsQueryExpression", () => {
  const cases: Array<[name: string, terms: string[], expected: string]> = [
    ["no terms", [], ""],
    ["single word gets prefix", ["kubernetes"], `'kubernetes':*`],
    [
      "multiple words compose with AND, no prefix",
      ["kubernetes", "deployment"],
      `'kubernetes' & 'deployment'`,
    ],
    [
      "operator words are quoted literals",
      ["foo", "AND", "bar"],
      `'foo' & 'AND' & 'bar'`,
    ],
    [
      "tsquery operator characters are literal inside the quoted lexeme",
      ["a&b", "c|d!e"],
      `'a&b' & 'c|d!e'`,
    ],
    ["colon in token", ["server:skill-creator"], `'server:skill-creator':*`],
    ["dash in token", ["mcp-server"], `'mcp-server':*`],
    ["asterisk in token", ["kube*"], `'kube*':*`],
    ["embedded single quotes stripped", ["foo'bar"], `'foobar':*`],
    ["embedded backslashes stripped", ["foo\\bar"], `'foobar':*`],
    ["only quotes sanitize to nothing", ["'''"], ""],
    [
      "a term sanitized to nothing is dropped from composition",
      ["foo", "'''", "bar"],
      `'foo' & 'bar'`,
    ],
  ];
  for (const [name, terms, expected] of cases) {
    it(name, () => {
      expect(renderTsQueryExpression(terms)).toBe(expected);
    });
  }

  it("the prefix decision counts terms AFTER sanitization (the ported order)", () => {
    // Two input terms, one sanitizes away — the survivor is a SINGLE term
    // and keeps prefix matching.
    expect(renderTsQueryExpression(["foo", "'''"])).toBe(`'foo':*`);
  });
});

describe("normalizeTsRankScore", () => {
  const cases: Array<[input: number, expected: number]> = [
    [-0.5, 0],
    [0, 0],
    [0.0573, 0.0573],
    [0.5, 0.5],
    [1, 1],
    [2.5, 1],
  ];
  for (const [input, expected] of cases) {
    it(`ts_rank ${input} → ${expected}`, () => {
      expect(normalizeTsRankScore(input)).toBe(expected);
    });
  }
});
