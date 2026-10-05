/**
 * Cross-edition lease-scope derivation parity.
 *
 * Loads the shared corpus (apis/testdata/hitl/lease-scope/vectors.json) and
 * asserts the runner's {@link deriveLeaseScope} agrees with it. The server's
 * lease-scope corpus test loads the same file, so a drift fails one of the
 * two suites: the guarantee that the calls an APPROVE_ALL approves on the
 * server are the calls the runner then lets through.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApprovalPolicySource, ApprovalPolicySourceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { deriveLeaseScope } from "../approval-policy.js";

type ExpectedScope =
  | { category: string }
  | { server: string }
  | { hook: string; tool: string; server: string }
  | null;

interface LeaseScopeVector {
  name: string;
  input: { toolName: string; mcpServerSlug?: string; policySource?: string; policyHook?: string };
  expected: ExpectedScope;
}

/** The corpus's proto enum name as the generated enum value. */
function sourceOf(name: string | undefined): ApprovalPolicySource {
  if (name === undefined) return ApprovalPolicySource.UNSPECIFIED;
  const value = ApprovalPolicySourceSchema.values.find((v) => v.name === name);
  if (value === undefined) throw new Error(`unknown ApprovalPolicySource in the corpus: ${name}`);
  return value.number as ApprovalPolicySource;
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
function asExpected(scope: ReturnType<typeof deriveLeaseScope>): ExpectedScope {
  if (!scope) return null;
  switch (scope.kind) {
    case "server":
      return { server: scope.server };
    case "category":
      return { category: scope.category };
    case "hook":
      return { hook: scope.hook, tool: scope.tool, server: scope.server };
  }
}

describe("lease-scope derivation vector corpus", () => {
  it("loads a non-trivial corpus", () => {
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(10);
  });

  for (const v of corpus.vectors) {
    it(`vector: ${v.name}`, () => {
      const actual = asExpected(
        deriveLeaseScope({
          name: v.input.toolName,
          mcpServerSlug: v.input.mcpServerSlug ?? "",
          approvalPolicySource: sourceOf(v.input.policySource),
          approvalPolicyHook: v.input.policyHook ?? "",
        }),
      );
      expect(actual).toEqual(v.expected);
    });
  }
});
