import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractZipFileEntries } from "../zip-extract.js";

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Build a minimal valid ZIP archive from an array of { name, content } entries.
 * Uses stored (method 0) compression for simplicity. Produces local file
 * headers only (no central directory) — sufficient for our parser.
 */
function buildStoredZip(files: { name: string; content: string }[]): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.name);
    const contentBytes = new TextEncoder().encode(file.content);
    const isDir = file.name.endsWith("/");

    // Local file header: 30 bytes
    const header = new ArrayBuffer(30);
    const view = new DataView(header);
    view.setUint32(0, 0x04034b50, true);  // signature
    view.setUint16(4, 20, true);           // version needed
    view.setUint16(6, 0, true);            // general purpose flags
    view.setUint16(8, 0, true);            // compression method (stored)
    view.setUint16(10, 0, true);           // last mod time
    view.setUint16(12, 0, true);           // last mod date
    view.setUint32(14, 0, true);           // crc-32 (unused for our purposes)
    view.setUint32(18, isDir ? 0 : contentBytes.length, true); // compressed size
    view.setUint32(22, isDir ? 0 : contentBytes.length, true); // uncompressed size
    view.setUint16(26, nameBytes.length, true);  // file name length
    view.setUint16(28, 0, true);           // extra field length

    parts.push(new Uint8Array(header));
    parts.push(nameBytes);
    if (!isDir) {
      parts.push(contentBytes);
    }
  }

  const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Build a ZIP archive with a single deflated (method 8) entry.
 */
function buildDeflatedZip(name: string, content: string): Uint8Array {
  const nameBytes = new TextEncoder().encode(name);
  const contentBytes = new TextEncoder().encode(content);
  const compressed = deflateRawSync(contentBytes);

  const header = new ArrayBuffer(30);
  const view = new DataView(header);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, 8, true);            // deflated
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, 0, true);
  view.setUint32(18, compressed.length, true);
  view.setUint32(22, contentBytes.length, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);

  const totalLength = 30 + nameBytes.length + compressed.length;
  const result = new Uint8Array(totalLength);
  result.set(new Uint8Array(header), 0);
  result.set(nameBytes, 30);
  result.set(new Uint8Array(compressed.buffer, compressed.byteOffset, compressed.length), 30 + nameBytes.length);
  return result;
}

// ─── extractZipFileEntries ───────────────────────────────────────────────

describe("extractZipFileEntries", () => {
  it("extracts stored files from a ZIP archive", async () => {
    const zip = buildStoredZip([
      { name: "SKILL.md", content: "# My Skill" },
      { name: "references/schema.md", content: "# Schema\n\nTable definitions." },
    ]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({ path: "SKILL.md", content: "# My Skill" });
    expect(entries[1]).toEqual({ path: "references/schema.md", content: "# Schema\n\nTable definitions." });
  });

  it("extracts deflated files", async () => {
    const content = "This content is compressed with deflate.";
    const zip = buildDeflatedZip("notes.txt", content);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ path: "notes.txt", content });
  });

  it("skips directory entries", async () => {
    const zip = buildStoredZip([
      { name: "references/", content: "" },
      { name: "references/data.md", content: "data" },
    ]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("references/data.md");
  });

  it("excludes files by basename", async () => {
    const zip = buildStoredZip([
      { name: "SKILL.md", content: "# Skill" },
      { name: "references/schema.md", content: "# Schema" },
      { name: "scripts/run.py", content: "print('hi')" },
    ]);

    const entries = await extractZipFileEntries(zip, { exclude: ["SKILL.md"] });
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.path)).toEqual(["references/schema.md", "scripts/run.py"]);
  });

  it("excludes files by full path", async () => {
    const zip = buildStoredZip([
      { name: "a.md", content: "a" },
      { name: "nested/a.md", content: "nested" },
    ]);

    const entries = await extractZipFileEntries(zip, { exclude: ["nested/a.md"] });
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("a.md");
  });

  it("excludes entries matching basename even when nested", async () => {
    const zip = buildStoredZip([
      { name: "SKILL.md", content: "root" },
      { name: "sub/SKILL.md", content: "sub" },
      { name: "data.md", content: "data" },
    ]);

    const entries = await extractZipFileEntries(zip, { exclude: ["SKILL.md"] });
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("data.md");
  });

  it("returns empty array for empty input", async () => {
    const entries = await extractZipFileEntries(new Uint8Array(0));
    expect(entries).toEqual([]);
  });

  it("returns empty array for truncated input", async () => {
    const entries = await extractZipFileEntries(new Uint8Array([1, 2, 3]));
    expect(entries).toEqual([]);
  });

  it("returns empty array for non-ZIP data", async () => {
    const garbage = new TextEncoder().encode("this is not a zip file at all");
    const entries = await extractZipFileEntries(garbage);
    expect(entries).toEqual([]);
  });

  it("handles multiple files with nested directories", async () => {
    const zip = buildStoredZip([
      { name: "SKILL.md", content: "# Skill" },
      { name: "references/", content: "" },
      { name: "references/database-schema.md", content: "# Schema" },
      { name: "references/player-segments.md", content: "# Segments" },
      { name: "references/retention-benchmarks.md", content: "# Benchmarks" },
    ]);

    const entries = await extractZipFileEntries(zip, { exclude: ["SKILL.md"] });
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.path)).toEqual([
      "references/database-schema.md",
      "references/player-segments.md",
      "references/retention-benchmarks.md",
    ]);
  });

  it("returns all entries when no exclude option is provided", async () => {
    const zip = buildStoredZip([
      { name: "a.txt", content: "aaa" },
      { name: "b.txt", content: "bbb" },
    ]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toHaveLength(2);
  });

  it("returns all entries when exclude list is empty", async () => {
    const zip = buildStoredZip([
      { name: "a.txt", content: "aaa" },
    ]);

    const entries = await extractZipFileEntries(zip, { exclude: [] });
    expect(entries).toHaveLength(1);
  });
});
