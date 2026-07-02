/**
 * Cross-edition lease-scope derivation parity.
 *
 * Loads the shared corpus (apis/testdata/hitl/lease-scope/vectors.json) and
 * asserts the TS {@link deriveLeaseScope} agrees with it. The Go
 * (lease_scope_corpus_test.go) and Java (LeaseScopeFixtureTest) editions load
 * the same file, so a drift in any edition fails one of the three suites — the
 * guarantee that an APPROVE_ALL clicked in one edition leases the same class
 * everywhere.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deriveLeaseScope } from "../approval-policy.js";

interface LeaseScopeVector {
  name: string;
  input: { toolName: string; mcpServerSlug?: string };
  expected: { category: string } | { server: string } | null;
}

const vectorsPath = fileURLToPath(
  new URL(
    "../../../../../../apis/testdata/hitl/lease-scope/vectors.json",
    import.meta.url,
  ),
);
const corpus = JSON.parse(readFileSync(vectorsPath, "utf-8")) as {
  vectors: LeaseScopeVector[];
};

/** Normalize the discriminated union to the corpus's plain JSON shape. */
function asExpected(
  scope: ReturnType<typeof deriveLeaseScope>,
): { category: string } | { server: string } | null {
  if (!scope) return null;
  return scope.kind === "server"
    ? { server: scope.server }
    : { category: scope.category };
}

describe("lease-scope derivation vector corpus", () => {
  it("loads a non-trivial corpus", () => {
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(10);
  });

  for (const v of corpus.vectors) {
    it(`vector: ${v.name}`, () => {
      const actual = asExpected(
        deriveLeaseScope(v.input.toolName, v.input.mcpServerSlug ?? ""),
      );
      expect(actual).toEqual(v.expected);
    });
  }
});
