import { describe, it, expect } from "vitest";
import { extractZipFileEntries } from "../zip-extract.js";
import { buildZip } from "../../__test-utils__/zip-fixtures.js";

// ─── extractZipFileEntries ───────────────────────────────────────────────

describe("extractZipFileEntries", () => {
  it("extracts stored files from a ZIP archive", async () => {
    const zip = buildZip([
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
    const zip = buildZip([{ name: "notes.txt", content, method: "deflated" }]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ path: "notes.txt", content });
  });

  it("skips directory entries", async () => {
    const zip = buildZip([
      { name: "references/", content: "" },
      { name: "references/data.md", content: "data" },
    ]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("references/data.md");
  });

  it("excludes files by basename", async () => {
    const zip = buildZip([
      { name: "SKILL.md", content: "# Skill" },
      { name: "references/schema.md", content: "# Schema" },
      { name: "scripts/run.py", content: "print('hi')" },
    ]);

    const entries = await extractZipFileEntries(zip, { exclude: ["SKILL.md"] });
    expect(entries).toHaveLength(2);
    expect(entries.map(e => e.path)).toEqual(["references/schema.md", "scripts/run.py"]);
  });

  it("excludes files by full path", async () => {
    const zip = buildZip([
      { name: "a.md", content: "a" },
      { name: "nested/a.md", content: "nested" },
    ]);

    const entries = await extractZipFileEntries(zip, { exclude: ["nested/a.md"] });
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe("a.md");
  });

  it("excludes entries matching basename even when nested", async () => {
    const zip = buildZip([
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
    const zip = buildZip([
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
    const zip = buildZip([
      { name: "a.txt", content: "aaa" },
      { name: "b.txt", content: "bbb" },
    ]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toHaveLength(2);
  });

  it("returns all entries when exclude list is empty", async () => {
    const zip = buildZip([{ name: "a.txt", content: "aaa" }]);

    const entries = await extractZipFileEntries(zip, { exclude: [] });
    expect(entries).toHaveLength(1);
  });

  // ── Streaming entries (issue #450) ─────────────────────────────────────

  it("extracts Go-default streaming archives (deflated, data descriptors)", async () => {
    const zip = buildZip([
      { name: "SKILL.md", content: "# Streamed Skill", method: "deflated", streaming: true },
      { name: "references/notes.md", content: "streamed notes", method: "deflated", streaming: true },
    ]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toEqual([
      { path: "SKILL.md", content: "# Streamed Skill" },
      { path: "references/notes.md", content: "streamed notes" },
    ]);
  });

  it("extracts a stored streaming entry whose payload embeds the data-descriptor signature", async () => {
    // The four bytes of the descriptor signature (0x08074b50, little-endian
    // "PK\x07\x08") planted mid-content, followed by twelve bytes a
    // descriptor-scanning parser would misread as CRC and sizes. The old
    // local-header walk truncated this entry at the planted signature and
    // desynchronized everything after it — the exact defect of issue #450.
    const poisoned = "before PK\u0007\u0008AAAABBBBCCCC after — full content survives";
    const zip = buildZip([
      { name: "poison.md", content: poisoned, streaming: true },
      { name: "after.md", content: "the entry after the poisoned one" },
    ]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toEqual([
      { path: "poison.md", content: poisoned },
      { path: "after.md", content: "the entry after the poisoned one" },
    ]);
  });

  it("uses central-directory sizes when local header sizes are zeroed", async () => {
    const content = "sizes live only in the central directory";
    const zip = buildZip([{ name: "cd-sizes.txt", content, streaming: true }]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toEqual([{ path: "cd-sizes.txt", content }]);
  });

  // ── Central directory edge cases ───────────────────────────────────────

  it("locates the EOCD behind a trailing archive comment", async () => {
    const zip = buildZip([{ name: "a.txt", content: "aaa" }], {
      comment: "release archive — built by tooling",
    });

    const entries = await extractZipFileEntries(zip);
    expect(entries).toEqual([{ path: "a.txt", content: "aaa" }]);
  });

  it("is not fooled by EOCD signature bytes inside the archive comment", async () => {
    // "PK\x05\x06" inside the comment is a decoy EOCD; validation must
    // reject it (its "fields" are comment text) and keep scanning backward
    // to the real record.
    const zip = buildZip([{ name: "a.txt", content: "aaa" }], {
      comment: "decoy: PK\u0005\u0006 not a real record",
    });

    const entries = await extractZipFileEntries(zip);
    expect(entries).toEqual([{ path: "a.txt", content: "aaa" }]);
  });

  it("returns empty array when the central directory is missing", async () => {
    // Local headers and payloads only — a download truncated before the
    // archive's index. The parser must not fall back to guessing from
    // local headers (design record 017).
    const zip = buildZip(
      [
        { name: "a.txt", content: "aaa" },
        { name: "b.txt", content: "bbb" },
      ],
      { omitCentralDirectory: true },
    );

    const entries = await extractZipFileEntries(zip);
    expect(entries).toEqual([]);
  });

  it("returns empty array for an archive with entries but a truncated tail", async () => {
    const zip = buildZip([{ name: "a.txt", content: "aaa" }]);
    const truncated = zip.subarray(0, zip.length - 10); // clips into the EOCD

    const entries = await extractZipFileEntries(truncated);
    expect(entries).toEqual([]);
  });

  it("extracts an empty archive (EOCD only) as no entries", async () => {
    const zip = buildZip([]);

    const entries = await extractZipFileEntries(zip);
    expect(entries).toEqual([]);
  });
});
