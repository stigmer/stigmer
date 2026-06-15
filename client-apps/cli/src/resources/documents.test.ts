import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UsageError } from "../errors/index.js";
import { loadDocuments, resolveYamlFiles } from "./documents.js";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "stigmer-docs-"));
  writeFileSync(join(dir, "single.yaml"), "kind: Agent\nmetadata:\n  slug: a\n");
  writeFileSync(join(dir, "multi.yaml"), "kind: Agent\nmetadata:\n  slug: a\n---\nkind: Workflow\nmetadata:\n  slug: w\n");
  writeFileSync(join(dir, "nokind.yaml"), "metadata:\n  slug: a\n");
  writeFileSync(join(dir, "broken.yaml"), "kind: Agent\nfoo: [1, 2\n");
  writeFileSync(join(dir, "notyaml.txt"), "ignored");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolveYamlFiles", () => {
  it("returns a single file directly", () => {
    expect(resolveYamlFiles(join(dir, "single.yaml"))).toEqual([join(dir, "single.yaml")]);
  });

  it("walks a directory for .yaml/.yml only", () => {
    const files = resolveYamlFiles(dir);
    expect(files).toContain(join(dir, "single.yaml"));
    expect(files).toContain(join(dir, "multi.yaml"));
    expect(files.some((f) => f.endsWith(".txt"))).toBe(false);
  });

  it("rejects a non-existent path with a usage error", () => {
    expect(() => resolveYamlFiles(join(dir, "missing.yaml"))).toThrow(UsageError);
  });
});

describe("loadDocuments", () => {
  it("loads a single document with the whole file as raw", () => {
    const docs = loadDocuments(join(dir, "single.yaml"));
    expect(docs).toHaveLength(1);
    expect(docs[0].kind).toBe("Agent");
    expect(docs[0].raw).toContain("kind: Agent");
  });

  it("splits multi-document files with per-document raw text", () => {
    const docs = loadDocuments(join(dir, "multi.yaml"));
    expect(docs.map((d) => d.kind)).toEqual(["Agent", "Workflow"]);
    expect(docs[0].raw).toContain("slug: a");
    expect(docs[0].raw).not.toContain("Workflow");
    expect(docs[1].raw).toContain("Workflow");
  });

  it("rejects a document missing its kind", () => {
    expect(() => loadDocuments(join(dir, "nokind.yaml"))).toThrow(UsageError);
  });

  it("rejects malformed YAML in strict mode", () => {
    expect(() => loadDocuments(join(dir, "broken.yaml"), { strict: true })).toThrow(UsageError);
  });

  it("tolerates malformed YAML in lenient mode (Wave-1 parity)", () => {
    expect(() => loadDocuments(join(dir, "broken.yaml"))).not.toThrow();
  });
});
