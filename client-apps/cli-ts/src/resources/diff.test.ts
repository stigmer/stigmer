import { describe, expect, it } from "vitest";
import { unifiedDiff } from "./diff.js";

describe("unifiedDiff", () => {
  it("emits the file headers", () => {
    const out = unifiedDiff("a", "b", "remote/x.yaml", "local/x.yaml", 3);
    expect(out.startsWith("--- remote/x.yaml\n+++ local/x.yaml\n")).toBe(true);
  });

  it("produces no hunk for identical input", () => {
    const out = unifiedDiff("x\ny\nz", "x\ny\nz", "remote/x", "local/x", 3);
    expect(out).not.toContain("@@");
  });

  it("renders a single-line change with trailing context", () => {
    const out = unifiedDiff("a\nb\nc", "a\nB\nc", "remote/x", "local/x", 3);
    expect(out).toContain("@@ -2,2 +2,2 @@");
    expect(out).toContain("-b");
    expect(out).toContain("+B");
    expect(out).toContain(" c");
  });

  it("renders a pure addition", () => {
    const out = unifiedDiff("a", "a\nb", "remote/x", "local/x", 3);
    expect(out).toContain("@@ -2,0 +2,1 @@");
    expect(out).toContain("+b");
  });

  it("renders a pure deletion", () => {
    const out = unifiedDiff("a\nb", "a", "remote/x", "local/x", 3);
    expect(out).toContain("-b");
    expect(out).not.toContain("+b");
  });
});
