/**
 * The TS-server half of the cross-edition lease-scope parity gate
 * (apis/testdata/hitl/lease-scope) — ports lease_scope_corpus_test.go +
 * lease_scope_test.go: every vector derives through deriveLeaseScope and
 * must equal the expected scope. The runner (TS) and Cloud (Java)
 * editions load the same file, so a drift fails one of the suites.
 */
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";

import { deriveLeaseScope, sameLeaseScope } from "../lease-scope.js";
import { hitlCorpusDir, readCorpusJson } from "./corpus-support.js";

interface LeaseScopeVector {
  name: string;
  input: { toolName?: string; mcpServerSlug?: string };
  expected: { category?: string; server?: string } | null;
}

describe("shared lease-scope corpus", () => {
  const doc = readCorpusJson(
    path.join(hitlCorpusDir(), "lease-scope", "vectors.json"),
  ) as unknown as { vectors: LeaseScopeVector[] };

  // Guard the guard (Go asserts >= 10 too).
  it("discovers the corpus", () => {
    expect(doc.vectors.length).toBeGreaterThanOrEqual(10);
  });

  for (const v of doc.vectors) {
    it(v.name, () => {
      const tc = create(ToolCallSchema, {
        name: v.input.toolName ?? "",
        mcpServerSlug: v.input.mcpServerSlug ?? "",
      });
      const scope = deriveLeaseScope(tc);

      if (v.expected === null) {
        expect(scope, "expected no leasable scope").toBeUndefined();
        return;
      }
      expect(scope, "expected a leasable scope").toBeDefined();
      expect(
        sameLeaseScope(scope as NonNullable<typeof scope>, {
          category: v.expected.category ?? "",
          server: v.expected.server ?? "",
        }),
      ).toBe(true);
    });
  }
});

describe("deriveLeaseScope unit pins (lease_scope_test.go)", () => {
  it("an MCP slug takes precedence over any category lookup", () => {
    const scope = deriveLeaseScope(
      create(ToolCallSchema, { name: "shell", mcpServerSlug: "github" }),
    );
    expect(scope).toEqual({ category: "", server: "github" });
  });

  it("a gated built-in derives its category", () => {
    const scope = deriveLeaseScope(create(ToolCallSchema, { name: "Write" }));
    expect(scope).toEqual({ category: "write", server: "" });
  });

  it("a read-only or unknown tool has no leasable scope", () => {
    expect(
      deriveLeaseScope(create(ToolCallSchema, { name: "read_file" })),
    ).toBeUndefined();
    expect(
      deriveLeaseScope(create(ToolCallSchema, { name: "" })),
    ).toBeUndefined();
  });
});
