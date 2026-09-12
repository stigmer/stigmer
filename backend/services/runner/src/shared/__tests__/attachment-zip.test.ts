/**
 * The ZIP guards an `extract` attachment passes before a byte is written
 * (`shared/attachment-zip.ts`): the manifest checks (paths, traversal, null
 * bytes, duplicates, methods, emptiness, count and declared-size caps) and
 * the central-directory parsing that issue #567 made authoritative. Moved
 * from the native injector's test file at S3 M1 with the code; every
 * archive comes from the shared real-shape builder
 * (@stigmer/zip-structure/testing). The write of an admitted entry is each
 * caller's and is pinned in that caller's tests (`attachment-resolver.test.ts`,
 * the injector's until M2b).
 */

import { describe, it, expect } from "vitest";
import { buildZip, type ZipFixtureFile } from "@stigmer/zip-structure/testing";
import {
  AttachmentValidationError,
  MAX_ZIP_EXTRACTED_SIZE,
  MAX_ZIP_FILES,
  validateZipForExtraction,
} from "../attachment-zip.js";

function makeZip(entries: Record<string, string | Buffer>): Buffer {
  return makeZipWith(entries, { method: "deflated" });
}

function makeStoredZip(entries: Record<string, Buffer>): Buffer {
  return makeZipWith(entries, { method: "stored" });
}

function makeZipWith(
  entries: Record<string, string | Buffer>,
  shape: Pick<ZipFixtureFile, "method" | "streaming">,
): Buffer {
  const files: ZipFixtureFile[] = Object.entries(entries).map(([name, content]) => ({
    name,
    content: typeof content === "string" ? content : new Uint8Array(content),
    ...shape,
  }));
  return Buffer.from(buildZip(files));
}

function makeDirectoryOnlyZip(): Buffer {
  return Buffer.from(buildZip([{ name: "empty_dir/", content: "" }]));
}

// ═══════════════════════════════════════════════════════════════════════
// validateZipForExtraction
// ═══════════════════════════════════════════════════════════════════════

describe("validateZipForExtraction", () => {
  it("returns sorted manifest for valid ZIP with multiple files", () => {
    const zip = makeZip({ "b.txt": "beta", "a.txt": "alpha", "c.txt": "charlie" });
    const result = validateZipForExtraction(zip, "test.zip");

    expect(result).toHaveLength(3);
    expect(result.map(e => e.relativePath)).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("preserves nested directory paths in entries", () => {
    const zip = makeZip({
      "src/main.py": "print('hi')",
      "README.md": "# Hello",
      "src/lib/util.py": "pass",
    });
    const result = validateZipForExtraction(zip, "project.zip");
    const paths = result.map(e => e.relativePath);

    expect(paths).toContain("src/main.py");
    expect(paths).toContain("src/lib/util.py");
    expect(paths).toContain("README.md");
  });

  it("reports correct uncompressed sizes", () => {
    const contentA = "hello world";
    const contentB = "x".repeat(500);
    const zip = makeZip({ "a.txt": contentA, "b.txt": contentB });

    const result = validateZipForExtraction(zip, "test.zip");
    const sizeMap = new Map(result.map(e => [e.relativePath, e.uncompressedSize]));

    expect(sizeMap.get("a.txt")).toBe(Buffer.from(contentA).length);
    expect(sizeMap.get("b.txt")).toBe(Buffer.from(contentB).length);
  });

  it("excludes directory-only entries", () => {
    const zip = makeDirectoryOnlyZip();
    expect(() => validateZipForExtraction(zip, "dirs.zip")).toThrow(
      AttachmentValidationError,
    );
  });

  it("rejects invalid ZIP format (random bytes)", () => {
    expect(() => validateZipForExtraction(Buffer.from("not-a-zip"), "bad.zip"))
      .toThrow(AttachmentValidationError);
    expect(() => validateZipForExtraction(Buffer.from("not-a-zip"), "bad.zip"))
      .toThrow(/not a valid ZIP archive/);
  });

  it("rejects file too small to be a ZIP", () => {
    expect(() => validateZipForExtraction(Buffer.from([0x50, 0x4b]), "tiny.zip"))
      .toThrow(/too small/);
  });

  it("rejects absolute path entries (forward slash)", () => {
    const zip = makeZip({ "/etc/passwd": "root:x:0:0" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/absolute path/);
  });

  it("rejects absolute path entries (backslash)", () => {
    const zip = makeZip({ "\\windows\\system32\\evil.dll": "payload" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/absolute path/);
  });

  it("rejects path traversal with leading ..", () => {
    const zip = makeZip({ "../../etc/passwd": "root:x:0:0" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/path traversal/);
  });

  it("rejects path traversal with embedded ..", () => {
    const zip = makeZip({ "foo/../../etc/passwd": "root:x:0:0" });
    expect(() => validateZipForExtraction(zip, "evil.zip"))
      .toThrow(/path traversal/);
  });

  it("rejects null bytes in filenames", () => {
    const zip = makeZip({ "file\u0000.txt": "test" });
    expect(() => validateZipForExtraction(zip, "null.zip"))
      .toThrow(/null bytes/);
  });

  it("rejects empty archive (valid ZIP, zero file entries)", () => {
    const zip = makeDirectoryOnlyZip();
    expect(() => validateZipForExtraction(zip, "empty.zip"))
      .toThrow(/empty ZIP archive/);
  });

  it("rejects file count exceeding limit", () => {
    const entries: Record<string, Buffer> = {};
    for (let i = 0; i < MAX_ZIP_FILES + 1; i++) {
      entries[`file_${String(i).padStart(4, "0")}.txt`] = Buffer.from("x");
    }
    const zip = makeStoredZip(entries);
    expect(() => validateZipForExtraction(zip, "bomb.zip"))
      .toThrow(new RegExp(`limit: ${MAX_ZIP_FILES}`));
  });

  it("rejects total uncompressed size exceeding limit", () => {
    const overLimit = MAX_ZIP_EXTRACTED_SIZE + 1;
    const zip = makeStoredZip({ "big.bin": Buffer.alloc(overLimit, 0) });
    expect(() => validateZipForExtraction(zip, "bomb.zip"))
      .toThrow(/limit: 100 MB/);
  });

  it("accepts ZIP at exactly the file count limit", () => {
    const entries: Record<string, Buffer> = {};
    for (let i = 0; i < MAX_ZIP_FILES; i++) {
      entries[`f${i}.txt`] = Buffer.from("x");
    }
    const zip = makeStoredZip(entries);
    const result = validateZipForExtraction(zip, "ok.zip");
    expect(result).toHaveLength(MAX_ZIP_FILES);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Central-directory parsing (issue #567)
// ═══════════════════════════════════════════════════════════════════════
// The archive shapes the old local-header walk corrupted or rejected:
// stored streaming entries (silent manifest truncation) and Go-default
// deflated streaming entries (rejected outright). Sizes come from the
// central directory — the format's authoritative index — and structural
// failures are fail-hard, unlike the skill-artifact reader's non-fatal
// empty return: nothing upstream vouches for an attachment.

describe("validateZipForExtraction — central-directory parsing (issue #567)", () => {
  it("validates every entry of a stored streaming archive (no silent truncation)", () => {
    // Method 0 + flag bit 3 + zeroed local sizes: the old walk admitted the
    // first entry with size 0, landed mid-payload, and quietly dropped the
    // rest of the manifest.
    const zip = Buffer.from(buildZip([
      { name: "first.txt", content: "first file content", streaming: true },
      { name: "second.txt", content: "second file content", streaming: true },
    ]));

    const result = validateZipForExtraction(zip, "streamed.zip");
    expect(result.map((e) => e.relativePath)).toEqual(["first.txt", "second.txt"]);
    expect(result.map((e) => e.uncompressedSize)).toEqual([
      "first file content".length,
      "second file content".length,
    ]);
  });

  it("accepts a Go-default archive (deflated streaming entries)", () => {
    const zip = Buffer.from(buildZip([
      { name: "main.go", content: "package main", method: "deflated", streaming: true },
      { name: "go.mod", content: "module example", method: "deflated", streaming: true },
    ]));

    const result = validateZipForExtraction(zip, "go-built.zip");
    expect(result.map((e) => e.relativePath)).toEqual(["go.mod", "main.go"]);
  });

  it("rejects an archive with no central directory (fail-hard, unlike skill extraction)", () => {
    const zip = Buffer.from(buildZip(
      [{ name: "a.txt", content: "aaa" }],
      { omitCentralDirectory: true },
    ));

    expect(() => validateZipForExtraction(zip, "truncated.zip"))
      .toThrow(AttachmentValidationError);
    expect(() => validateZipForExtraction(zip, "truncated.zip"))
      .toThrow(/not a valid ZIP archive/);
  });

  it("rejects duplicate entry paths (a contradictory manifest)", () => {
    const zip = Buffer.from(buildZip([
      { name: "dup.txt", content: "one" },
      { name: "dup.txt", content: "two" },
    ]));

    expect(() => validateZipForExtraction(zip, "dup.zip"))
      .toThrow(/duplicate entry/);
  });

  it("locates the central directory behind a trailing archive comment", () => {
    const zip = Buffer.from(buildZip(
      [{ name: "a.txt", content: "aaa" }],
      { comment: "release archive — built by tooling" },
    ));

    const result = validateZipForExtraction(zip, "commented.zip");
    expect(result.map((e) => e.relativePath)).toEqual(["a.txt"]);
  });
});
