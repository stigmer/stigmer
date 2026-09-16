/**
 * Pins the reader contract and the path discipline: lexical containment of
 * listed and declared paths, the sorted in-memory reader, the index's
 * directory queries, BOM stripping, and the two-sided document cap (the
 * declared size before a read, the returned length after, so a reader that
 * under-declares cannot smuggle bytes past the cap).
 */

import { describe, expect, it } from "vitest";

import {
  decodeUtf8,
  inMemoryPluginFiles,
  isContainedPath,
  PLUGIN_DOCUMENT_LIMITS,
  PluginFileIndex,
  type PluginFiles,
  resolveDeclaredPath,
} from "../files.js";
import { readPluginPackage } from "../read-plugin-package.js";
import { openPlugin } from "../testing.js";
import { kindsOf, read } from "../__test-utils__/read.js";

describe("isContainedPath", () => {
  it("accepts plugin-relative POSIX paths", () => {
    expect(isContainedPath("plugin.json")).toBe(true);
    expect(isContainedPath("skills/a/SKILL.md")).toBe(true);
    expect(isContainedPath(".cursor-plugin/plugin.json")).toBe(true);
  });

  it("refuses absolute, parent, dot, empty-segment and backslash paths", () => {
    for (const path of ["", "/etc/passwd", "../x", "a/../b", "a/./b", "a//b", "a\\b", "a/"]) {
      expect(isContainedPath(path), path).toBe(false);
    }
  });
});

describe("resolveDeclaredPath", () => {
  it("normalises ./-prefixed directories and files, and the root spellings", () => {
    expect(resolveDeclaredPath("./skills/")).toEqual({ ok: true, path: "skills" });
    expect(resolveDeclaredPath("./agents/reviewer.md")).toEqual({ ok: true, path: "agents/reviewer.md" });
    expect(resolveDeclaredPath(".")).toEqual({ ok: true, path: "" });
    expect(resolveDeclaredPath("./")).toEqual({ ok: true, path: "" });
  });

  it("refuses a bare, an escaping and a glob path, each with its own kind", () => {
    expect(resolveDeclaredPath("skills/")).toEqual({ ok: false, kind: "path-not-relative" });
    expect(resolveDeclaredPath("./../other")).toEqual({ ok: false, kind: "path-escapes-root" });
    expect(resolveDeclaredPath("./skills/**/*.md")).toEqual({ ok: false, kind: "path-glob-unsupported" });
  });
});

describe("inMemoryPluginFiles and PluginFileIndex", () => {
  const files = inMemoryPluginFiles(
    new Map<string, string>([
      ["skills/b/SKILL.md", "b"],
      ["skills/a/SKILL.md", "a"],
      ["skills/a/scripts/run.sh", "run"],
      ["plugin.json", "{}"],
      ["agents/x.md", "x"],
    ]),
  );
  const index = new PluginFileIndex(files);

  it("lists entries sorted by path with their byte sizes", () => {
    expect(files.entries.map((e) => e.path)).toEqual([
      "agents/x.md",
      "plugin.json",
      "skills/a/SKILL.md",
      "skills/a/scripts/run.sh",
      "skills/b/SKILL.md",
    ]);
    expect(files.entries.find((e) => e.path === "skills/a/scripts/run.sh")?.size).toBe(3);
  });

  it("answers directory queries from the sorted list", () => {
    expect(index.childDirectories("")).toEqual(["agents", "skills"]);
    expect(index.childDirectories("skills")).toEqual(["a", "b"]);
    expect(index.childFiles("")).toEqual(["plugin.json"]);
    expect(index.filesUnder("skills/a")).toEqual(["skills/a/SKILL.md", "skills/a/scripts/run.sh"]);
    expect(index.isDirectory("skills/a/scripts")).toBe(true);
    expect(index.isDirectory("nope")).toBe(false);
  });

  it("throws on a read of an unlisted path (a reader contract violation, not plugin content)", () => {
    expect(() => files.read("missing")).toThrow(/not listed/);
  });
});

describe("decodeUtf8", () => {
  it("strips a leading byte-order mark and nothing else", () => {
    expect(decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toBe("{}");
    expect(decodeUtf8(new TextEncoder().encode("a\ufeffb"))).toBe("a\ufeffb");
  });
});

describe("document caps", () => {
  it("refuses a manifest over its declared-size cap before reading it", () => {
    const huge = `{"name":"x","pad":"${"a".repeat(PLUGIN_DOCUMENT_LIMITS.manifest)}"}`;
    const files = openPlugin({ files: { "plugin.json": huge } });
    const outcome = read(files);
    expect(kindsOf(outcome).errors).toEqual(["document-too-large", "manifest-name-missing"]);
  });

  it("refuses a document whose reader returned more bytes than it declared", () => {
    const manifest = JSON.stringify({ $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json", name: "x" });
    const lying: PluginFiles = {
      entries: [{ path: "plugin.json", size: 1 }],
      read: () => new TextEncoder().encode(manifest.padEnd(PLUGIN_DOCUMENT_LIMITS.manifest + 1, " ")),
    };
    const outcome = readPluginPackage(lying);
    expect(kindsOf(outcome).errors).toEqual(["document-too-large", "manifest-name-missing"]);
  });

  it("refuses a listed path outside the root", () => {
    const files = openPlugin({ files: { "../escape.txt": "x" } });
    expect(kindsOf(read(files)).errors).toEqual(["path-uncontained"]);
  });
});
