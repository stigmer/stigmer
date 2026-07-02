/**
 * Cross-edition authorization-provenance parity.
 *
 * Loads the shared corpus (apis/testdata/hitl/policy-source/vectors.json) and
 * asserts the runner's {@link toProtoPolicySource} maps each PolicySource onto
 * the proto enum number the backends consume. The Go (policy_source_corpus_test.go)
 * and Java (PolicySourceFixtureTest) editions load the same file and assert the
 * generated enum resolves the same name to the same number, so a drift in the
 * runner mapping or a renumbering of the enum in any edition fails one of the
 * three suites — the guarantee that a persisted approval_policy_source means the
 * same thing everywhere.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ApprovalPolicySource } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { toProtoPolicySource, type PolicySource } from "../approval-policy.js";

interface PolicySourceVector {
  name: string;
  policySource: PolicySource | null;
  name_proto: string;
  number: number;
}

const vectorsPath = fileURLToPath(
  new URL(
    "../../../../../../apis/testdata/hitl/policy-source/vectors.json",
    import.meta.url,
  ),
);
const corpus = JSON.parse(readFileSync(vectorsPath, "utf-8")) as {
  vectors: PolicySourceVector[];
};

describe("policy-source mapping vector corpus", () => {
  it("loads the full enum corpus", () => {
    // One vector per ApprovalPolicySource value (incl. UNSPECIFIED).
    const enumValueCount = Object.values(ApprovalPolicySource).filter(
      (v) => typeof v === "number",
    ).length;
    expect(corpus.vectors.length).toBe(enumValueCount);
  });

  for (const v of corpus.vectors) {
    it(`vector: ${v.name}`, () => {
      // The runner maps undefined (no governing layer) -> UNSPECIFIED; the corpus
      // encodes that case as policySource: null.
      const source = v.policySource ?? undefined;
      expect(toProtoPolicySource(source)).toBe(v.number);
      // The generated enum's reverse lookup must name the same value, with the
      // proto prefix the backends use stripped to the runner's short member name.
      const shortName = v.name_proto.replace("APPROVAL_POLICY_SOURCE_", "");
      expect(ApprovalPolicySource[v.number]).toBe(shortName);
    });
  }
});
