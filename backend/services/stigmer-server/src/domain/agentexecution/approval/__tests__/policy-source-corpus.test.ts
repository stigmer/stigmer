/**
 * The TS-server half of the cross-edition authorization-provenance parity
 * gate (apis/testdata/hitl/policy-source) — ports
 * policy_source_corpus_test.go: every vector's proto enum name must
 * resolve, through the generated ApprovalPolicySource descriptor, to the
 * pinned number, and the reverse mapping must agree. A renumbering in any
 * edition fails one of the suites.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ApprovalPolicySourceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { hitlCorpusDir, readCorpusJson } from "./corpus-support.js";

interface PolicySourceVector {
  name: string;
  name_proto: string;
  number: number;
}

describe("shared policy-source corpus", () => {
  const doc = readCorpusJson(
    path.join(hitlCorpusDir(), "policy-source", "vectors.json"),
  ) as unknown as { vectors: PolicySourceVector[] };

  // Guard the guard: the corpus must cover every enum value, so a
  // silently truncated file cannot pass for the wrong reason.
  it("covers every enum value", () => {
    expect(doc.vectors.length).toBe(ApprovalPolicySourceSchema.values.length);
  });

  for (const v of doc.vectors) {
    it(v.name, () => {
      const byName = ApprovalPolicySourceSchema.values.find(
        (value) => value.name === v.name_proto,
      );
      expect(byName, `enum name ${v.name_proto} exists`).toBeDefined();
      expect(byName?.number).toBe(v.number);

      // The reverse map must agree, locking the name<->number pairing.
      const byNumber = ApprovalPolicySourceSchema.values.find(
        (value) => value.number === v.number,
      );
      expect(byNumber?.name).toBe(v.name_proto);
    });
  }
});
