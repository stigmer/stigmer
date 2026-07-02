import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  APPROVAL_FINGERPRINT_VERSION,
  coarseToolIdentity,
  computeApprovalFingerprint,
  computeCoarseApprovalFingerprint,
  deriveExecutionFingerprintKey,
} from "../approval-fingerprint.js";
import type { ToolActionInput } from "../approval-canonicalize.js";

interface FingerprintVector {
  name: string;
  input: ToolActionInput;
  expected: string;
}

// Single source of truth, shared byte-for-byte with the future Go/Java editions.
const vectorsPath = fileURLToPath(
  new URL("../../../../../../apis/testdata/hitl/fingerprint/vectors.json", import.meta.url),
);
const corpus = JSON.parse(readFileSync(vectorsPath, "utf-8")) as {
  key: string;
  full: FingerprintVector[];
  coarse: FingerprintVector[];
};

describe("approval fingerprint vector corpus", () => {
  it("loads a non-trivial corpus", () => {
    expect(corpus.full.length).toBeGreaterThanOrEqual(4);
    expect(corpus.coarse.length).toBeGreaterThanOrEqual(4);
  });

  for (const v of corpus.full) {
    it(`full vector: ${v.name}`, () => {
      expect(computeApprovalFingerprint(corpus.key, v.input)).toBe(v.expected);
    });
  }

  for (const v of corpus.coarse) {
    it(`coarse vector: ${v.name}`, () => {
      expect(computeCoarseApprovalFingerprint(corpus.key, v.input)).toBe(v.expected);
    });
  }
});

describe("fingerprint invariants", () => {
  const key = "test-key";

  it("tags every fingerprint with the version", () => {
    const fp = computeApprovalFingerprint(key, { toolName: "read" });
    expect(fp.startsWith(`${APPROVAL_FINGERPRINT_VERSION}:`)).toBe(true);
  });

  it("is stable for the same action (an approval re-driven is the same lease)", () => {
    const input: ToolActionInput = { toolName: "Write", paths: ["src/a.ts"], args: { contents: "x" } };
    expect(computeApprovalFingerprint(key, input)).toBe(computeApprovalFingerprint(key, input));
  });

  it("changes when the action changes (a drifted action is re-asked, never reused)", () => {
    const a = computeApprovalFingerprint(key, { toolName: "Write", paths: ["src/a.ts"] });
    const b = computeApprovalFingerprint(key, { toolName: "Write", paths: ["src/b.ts"] });
    expect(a).not.toBe(b);
  });

  it("is key-bound (a fingerprint from one key cannot satisfy another)", () => {
    const input: ToolActionInput = { toolName: "Shell", shellCommand: "rm -rf /" };
    expect(computeApprovalFingerprint("key-a", input)).not.toBe(computeApprovalFingerprint("key-b", input));
  });
});

describe("coarse projection (Cursor substrate)", () => {
  it("collapses the write/edit taxonomies onto one identity", () => {
    // Same logical edit named in the hook taxonomy (Write) and the stream
    // taxonomy (edit) over the same resource -> one fingerprint. This is the
    // March-2026 failure class, prevented by construction.
    const hookSide: ToolActionInput = { toolName: "Write", paths: ["a.txt"] };
    const streamSide: ToolActionInput = { toolName: "edit", paths: ["a.txt"] };
    expect(coarseToolIdentity(hookSide).tool).toBe("write");
    expect(coarseToolIdentity(streamSide).tool).toBe("write");
    expect(computeCoarseApprovalFingerprint("k", hookSide)).toBe(
      computeCoarseApprovalFingerprint("k", streamSide),
    );
  });

  it("isolates categories (approving a write never satisfies a shell)", () => {
    const write: ToolActionInput = { toolName: "Write", paths: ["a.txt"] };
    const shell: ToolActionInput = { toolName: "Shell", shellCommand: "a.txt" };
    expect(computeCoarseApprovalFingerprint("k", write)).not.toBe(
      computeCoarseApprovalFingerprint("k", shell),
    );
  });

  it("keys MCP tools on tool name with an empty salient", () => {
    const id = coarseToolIdentity({ toolName: "create_issue", mcpServerSlug: "GitHub" });
    expect(id).toEqual({ tool: "create_issue", mcpServerSlug: "github", salient: "" });
  });
});

describe("per-execution key derivation", () => {
  it("is stable for the same execution (gateway approves and enforces across re-invocations)", () => {
    const master = "master-secret";
    expect(deriveExecutionFingerprintKey(master, "exec-1")).toEqual(
      deriveExecutionFingerprintKey(master, "exec-1"),
    );
  });

  it("isolates executions (a key from one execution cannot serve another)", () => {
    const master = "master-secret";
    expect(deriveExecutionFingerprintKey(master, "exec-1")).not.toEqual(
      deriveExecutionFingerprintKey(master, "exec-2"),
    );
  });
});
