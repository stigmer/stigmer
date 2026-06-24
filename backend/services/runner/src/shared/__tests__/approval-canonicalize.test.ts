import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  canonicalJson,
  canonicalToolActionJson,
  canonicalizeToolAction,
  type ToolActionInput,
} from "../approval-canonicalize.js";

interface Vector {
  name: string;
  input: ToolActionInput;
  expected: string;
}

// Single source of truth, shared with the future Go/Java implementations.
const vectorsPath = fileURLToPath(
  new URL("../../../../../../apis/testdata/hitl/canonicalization/vectors.json", import.meta.url),
);
const corpus = JSON.parse(readFileSync(vectorsPath, "utf-8")) as { vectors: Vector[] };

describe("approval canonicalization vector corpus", () => {
  it("loads a non-trivial corpus", () => {
    expect(corpus.vectors.length).toBeGreaterThanOrEqual(10);
  });

  for (const v of corpus.vectors) {
    it(`vector: ${v.name}`, () => {
      expect(canonicalToolActionJson(v.input)).toBe(v.expected);
    });
  }
});

describe("canonicalJson", () => {
  it("sorts object keys by UTF-16 code unit", () => {
    expect(canonicalJson({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined-valued keys", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects non-integer numbers (outside the canonical domain)", () => {
    expect(() => canonicalJson({ x: 1.5 })).toThrow(/non-integer/);
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ x: Infinity })).toThrow(/non-finite/);
  });
});

describe("canonicalizeToolAction normalization", () => {
  it("is idempotent (canonicalizing the canonical form is a fixed point)", () => {
    const input: ToolActionInput = {
      toolName: "Write",
      paths: ["/ws/src/b.ts", "/ws/src/a.ts"],
      workspaceRoot: "/ws",
      args: { flag: true },
    };
    const once = canonicalToolActionJson(input);
    const twice = canonicalToolActionJson(input);
    expect(twice).toBe(once);
  });

  it("redacts secret values to a stable digest without cleartext", () => {
    const input: ToolActionInput = {
      toolName: "create_secret",
      args: { name: "db", value: "super-secret-password" },
      secretKeys: ["value"],
    };
    const out = canonicalizeToolAction(input);
    const redacted = out.args.value as string;

    expect(redacted).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(redacted).not.toContain("super-secret-password");
    expect(canonicalToolActionJson(input)).not.toContain("super-secret-password");
  });

  it("redaction is stable for the same secret and distinct for different secrets", () => {
    const base = (value: string): ToolActionInput => ({
      toolName: "t",
      args: { value },
      secretKeys: ["value"],
    });
    const a1 = canonicalizeToolAction(base("secret-a")).args.value;
    const a2 = canonicalizeToolAction(base("secret-a")).args.value;
    const b = canonicalizeToolAction(base("secret-b")).args.value;

    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
  });

  it("makes a workspace-absolute path relative and normalizes separators", () => {
    const out = canonicalizeToolAction({
      toolName: "Write",
      paths: ["C:\\ws\\src\\main.ts"],
      workspaceRoot: "C:\\ws",
    });
    expect(out.paths).toEqual(["src/main.ts"]);
  });
});
