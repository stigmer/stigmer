/**
 * The archive's table of contents: every file with its size, SHA-256,
 * executable bit and stored range, the eval suite's directories, and a
 * stored document that reads back only when it is one this format wrote.
 */
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";

import { describe, expect, it } from "vitest";
import { buildZip } from "@stigmer/zip-structure/testing";

import {
  buildArchiveFileIndex,
  decodeArchiveFileIndex,
  encodeArchiveFileIndex,
  fileIndexKeyPrefix,
  inSuiteDir,
} from "../file-index.js";

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

describe("buildArchiveFileIndex", () => {
  it("lists every file in path order with its size, hash, executable bit and stored range", () => {
    const bytes = buildZip([
      { name: "SKILL.md", content: "---\nname: a\n---\nbody" },
      { name: "scripts/run.sh", content: "echo hi", method: "deflated" },
      { name: "bin/tool", content: "#!/bin/sh\n" },
      { name: "docs/", content: "" },
    ]);
    const index = buildArchiveFileIndex(bytes, "skill");
    expect(index.files.map((file) => file.path)).toEqual(["SKILL.md", "bin/tool", "scripts/run.sh"]);
    const run = index.files.find((file) => file.path === "scripts/run.sh")!;
    expect(run).toMatchObject({ size: 7, sha256: sha("echo hi"), executable: true, method: 8 });
    expect(new TextDecoder().decode(inflateRawSync(bytes.subarray(run.offset, run.offset + run.storedSize)))).toBe("echo hi");
    expect(index.files.find((file) => file.path === "bin/tool")!.executable).toBe(true);
    expect(index.files.find((file) => file.path === "SKILL.md")!.executable).toBe(false);
  });

  it("names no suite directory for a skill pushed on its own, whose evals/ is its own", () => {
    const index = buildArchiveFileIndex(buildZip([{ name: "SKILL.md", content: "x" }, { name: "evals/evals.json", content: "{}" }]), "skill");
    expect(index.suiteDirs).toEqual([]);
    expect(index.files.map((file) => file.path)).toContain("evals/evals.json");
  });

  it("names evals/ and the manifest's suite directory for a plugin, and for a skill holding a plugin manifest", () => {
    const files = [
      { name: ".claude-plugin/plugin.json", content: JSON.stringify({ name: "p", experimental: { evals: "./qa" } }) },
      { name: "skills/a/SKILL.md", content: "x" },
    ];
    expect(buildArchiveFileIndex(buildZip(files), "plugin").suiteDirs).toEqual(["evals", "qa"]);
    expect(buildArchiveFileIndex(buildZip(files), "skill").suiteDirs).toEqual(["evals", "qa"]);
    expect(buildArchiveFileIndex(buildZip([{ name: "plugin.json", content: "{}" }]), "plugin").suiteDirs).toEqual(["evals"]);
  });

  it("refuses an archive whose entry does not match its CRC", () => {
    const bytes = buildZip([{ name: "SKILL.md", content: "abc" }]);
    const at = Buffer.from(bytes).indexOf("abc");
    bytes[at] = "x".charCodeAt(0);
    expect(() => buildArchiveFileIndex(bytes, "skill")).toThrow(/checksum/);
  });
});

describe("the stored document", () => {
  const index = buildArchiveFileIndex(buildZip([{ name: "SKILL.md", content: "x" }]), "skill");

  it("reads back what it wrote", () => {
    expect(decodeArchiveFileIndex(encodeArchiveFileIndex(index))).toEqual(index);
  });

  it("reads back nothing from another format or a torn write, so the reader builds it again", () => {
    const text = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
    expect(decodeArchiveFileIndex(text({ ...index, format: 2 }))).toBeUndefined();
    expect(decodeArchiveFileIndex(text({ ...index, files: [{ path: "a" }] }))).toBeUndefined();
    expect(decodeArchiveFileIndex(encodeArchiveFileIndex(index).subarray(0, 10))).toBeUndefined();
  });

  it("lives under a prefix that names its format and no download lane admits", () => {
    expect(fileIndexKeyPrefix("skill")).toBe("skill-indexes/v1/");
    expect(fileIndexKeyPrefix("plugin")).toBe("plugin-indexes/v1/");
  });
});

describe("inSuiteDir", () => {
  it("holds a path under a suite directory and nothing beside it", () => {
    expect(inSuiteDir("evals/case/prompt.md", ["evals"])).toBe(true);
    expect(inSuiteDir("evals-notes.md", ["evals"])).toBe(false);
    expect(inSuiteDir("evals", ["evals"])).toBe(false);
    expect(inSuiteDir("a/evals/x", ["evals"])).toBe(false);
  });
});
