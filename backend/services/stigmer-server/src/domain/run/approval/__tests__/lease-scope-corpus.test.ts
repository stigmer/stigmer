/**
 * The server half of the lease-scope parity gate
 * (apis/testdata/hitl/lease-scope) — ports lease_scope_corpus_test.go +
 * lease_scope_test.go: every vector derives through deriveLeaseScope and
 * must equal the expected scope, a hook's scope included. The runner loads
 * the same file, so a drift fails one of the two suites. A vector names
 * its policy source by the runner's ApprovalPolicySource enum name; the
 * server derives from the ask as the session's log states it, whose
 * stigmer.permission.asked event carries the source as one word. The
 * policy-source corpus (apis/testdata/hitl/policy-source) pairs each enum
 * name with that word, so each vector's name is read through it.
 */
import path from "node:path";

import { describe, expect, it } from "vitest";

import { deriveLeaseScope, sameLeaseScope } from "../lease-scope.js";
import type { LeaseSubject } from "../lease-scope.js";
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

interface PolicySourceVector {
  /** The asked event's word; null for UNSPECIFIED, which an asked event leaves empty. */
  policySource: string | null;
  name_proto: string;
}

/** The asked event's word for each enum name, from the policy-source corpus. */
const POLICY_SOURCE_WORDS: ReadonlyMap<string, string> = new Map(
  (
    readCorpusJson(path.join(hitlCorpusDir(), "policy-source", "vectors.json")) as unknown as {
      vectors: PolicySourceVector[];
    }
  ).vectors.map((v) => [v.name_proto, v.policySource ?? ""]),
);

/** The asked event's word for a vector's enum name ("" for none); an unknown name fails the vector. */
function policySourceOf(name: string | undefined): string {
  if (name === undefined) {
    return "";
  }
  const word = POLICY_SOURCE_WORDS.get(name);
  if (word === undefined) {
    throw new Error(`unknown ApprovalPolicySource name in corpus: ${name}`);
  }
  return word;
}

function ask(subject: Partial<LeaseSubject> & Pick<LeaseSubject, "name">): LeaseSubject {
  return { mcpServer: "", policySource: "", policyHook: "", ...subject };
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
      const scope = deriveLeaseScope({
        name: v.input.toolName ?? "",
        mcpServer: v.input.mcpServerSlug ?? "",
        policySource: policySourceOf(v.input.policySource),
        policyHook: v.input.policyHook ?? "",
      });

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
    const scope = deriveLeaseScope(ask({ name: "shell", mcpServer: "github" }));
    expect(scope).toEqual({ category: "", server: "github", tool: "" });
  });

  it("a gated built-in derives its category", () => {
    const scope = deriveLeaseScope(ask({ name: "Write" }));
    expect(scope).toEqual({ category: "write", server: "", tool: "" });
  });

  it("a hook's ask leases that hook on that tool, a read-only one included, and never matches the default's scope", () => {
    const hooked = deriveLeaseScope(ask({ name: "execute", policySource: "hook", policyHook: "safety" }));
    expect(hooked).toEqual({
      category: "",
      server: "",
      hook: "safety",
      tool: "execute",
    });
    const byDefault = deriveLeaseScope(ask({ name: "execute" }));
    expect(sameLeaseScope(hooked!, byDefault!)).toBe(false);
    expect(
      deriveLeaseScope(ask({ name: "read_file", policySource: "hook" })),
    ).toEqual({ category: "", server: "", hook: "", tool: "read_file" });
  });

  it("a read-only or unknown tool has no leasable scope", () => {
    expect(deriveLeaseScope(ask({ name: "read_file" }))).toBeUndefined();
    expect(deriveLeaseScope(ask({ name: "" }))).toBeUndefined();
  });

  it("a hook slug on an ask no hook decided is ignored", () => {
    expect(
      deriveLeaseScope(ask({ name: "Write", policySource: "builtin_category", policyHook: "safety" })),
    ).toEqual({ category: "write", server: "", tool: "" });
  });
});
