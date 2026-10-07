/**
 * The server half of the lease-scope parity gate
 * (apis/testdata/hitl/lease-scope) — ports lease_scope_corpus_test.go +
 * lease_scope_test.go: every vector derives through deriveLeaseScope and
 * must equal the expected scope, a hook's scope included. The runner loads
 * the same file, so a drift fails one of the two suites.
 */
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import {
  ApprovalPolicySource,
  ApprovalPolicySourceSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/message_pb";

import { deriveLeaseScope, sameLeaseScope } from "../lease-scope.js";
import { hitlCorpusDir, readCorpusJson } from "./corpus-support.js";

interface LeaseScopeVector {
  name: string;
  input: {
    toolName?: string;
    mcpServerSlug?: string;
    /** The proto enum value name, e.g. APPROVAL_POLICY_SOURCE_HOOK. */
    policySource?: string;
    policyHook?: string;
  };
  expected: {
    category?: string;
    server?: string;
    hook?: string;
    tool?: string;
  } | null;
}

/** The enum value a vector's proto name names; an unknown name fails the vector. */
function policySourceOf(name: string | undefined): ApprovalPolicySource {
  if (name === undefined) {
    return ApprovalPolicySource.UNSPECIFIED;
  }
  const value = ApprovalPolicySourceSchema.values.find((v) => v.name === name);
  if (value === undefined) {
    throw new Error(`unknown ApprovalPolicySource name in corpus: ${name}`);
  }
  return value.number;
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
        approvalPolicySource: policySourceOf(v.input.policySource),
        approvalPolicyHook: v.input.policyHook ?? "",
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
          hook: v.expected.hook,
          tool: v.expected.tool ?? "",
        }),
        JSON.stringify(scope),
      ).toBe(true);
    });
  }
});

describe("deriveLeaseScope unit pins (lease_scope_test.go)", () => {
  it("an MCP slug takes precedence over any category lookup", () => {
    const scope = deriveLeaseScope(
      create(ToolCallSchema, { name: "shell", mcpServerSlug: "github" }),
    );
    expect(scope).toEqual({ category: "", server: "github", tool: "" });
  });

  it("a gated built-in derives its category", () => {
    const scope = deriveLeaseScope(create(ToolCallSchema, { name: "Write" }));
    expect(scope).toEqual({ category: "write", server: "", tool: "" });
  });

  it("a hook's ask leases that hook on that tool, a read-only one included, and never matches the default's scope", () => {
    const hooked = deriveLeaseScope(
      create(ToolCallSchema, {
        name: "execute",
        approvalPolicySource: ApprovalPolicySource.HOOK,
        approvalPolicyHook: "safety",
      }),
    );
    expect(hooked).toEqual({
      category: "",
      server: "",
      hook: "safety",
      tool: "execute",
    });
    const byDefault = deriveLeaseScope(
      create(ToolCallSchema, { name: "execute" }),
    );
    expect(sameLeaseScope(hooked!, byDefault!)).toBe(false);
    expect(
      deriveLeaseScope(
        create(ToolCallSchema, {
          name: "read_file",
          approvalPolicySource: ApprovalPolicySource.HOOK,
        }),
      ),
    ).toEqual({ category: "", server: "", hook: "", tool: "read_file" });
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
