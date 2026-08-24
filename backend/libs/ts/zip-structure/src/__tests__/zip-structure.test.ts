/**
 * The structural layer's own suite. Until the lib extraction this module
 * was tested only through its consumers (the runner's zip-extract and
 * attachment-injector suites); per ci.ts-libs' contract a lib change must
 * fail attributably here even when no consumer file moved.
 */
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildZip } from "../testing.js";
import { parseZipStructure } from "../zip-structure.js";

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("parseZipStructure", () => {
  it("enumerates stored entries with names, sizes, and payload views", () => {
    const zip = buildZip([
      { name: "SKILL.md", content: "# Skill" },
      { name: "references/schema.md", content: "tables" },
    ]);

    const entries = parseZipStructure(zip);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.name).toBe("SKILL.md");
    expect(entries[0]!.compressionMethod).toBe(0);
    expect(entries[0]!.uncompressedSize).toBe("# Skill".length);
    expect(entries[0]!.compressedSize).toBe("# Skill".length);
    expect(text(entries[0]!.compressedData)).toBe("# Skill");
    expect(entries[1]!.name).toBe("references/schema.md");
  });

  it("inflates a deflated entry's payload back to the original bytes", () => {
    const content = "compressed with deflate, long enough to actually shrink ".repeat(8);
    const zip = buildZip([{ name: "notes.txt", content, method: "deflated" }]);

    const [entry] = parseZipStructure(zip);
    expect(entry!.compressionMethod).toBe(8);
    expect(text(new Uint8Array(inflateRawSync(entry!.compressedData)))).toBe(content);
  });

  it("reads sizes from the central directory for streaming entries (zeroed local headers, #450)", () => {
    const content = "streamed by Go's archive/zip writer";
    const zip = buildZip([{ name: "streamed.md", content, streaming: true }]);

    const [entry] = parseZipStructure(zip);
    expect(entry!.uncompressedSize).toBe(content.length);
    expect(text(entry!.compressedData)).toBe(content);
  });

  it("marks directory entries", () => {
    const zip = buildZip([
      { name: "references/", content: "" },
      { name: "references/data.md", content: "data" },
    ]);

    const entries = parseZipStructure(zip);
    expect(entries[0]!.isDirectory).toBe(true);
    expect(entries[1]!.isDirectory).toBe(false);
  });

  it("locates the EOCD behind a trailing archive comment", () => {
    const zip = buildZip([{ name: "a.md", content: "a" }], { comment: "trailing comment" });
    expect(parseZipStructure(zip)).toHaveLength(1);
  });

  it("is not fooled by EOCD signature bytes inside the comment", () => {
    // The four signature bytes ("PK\x05\x06") occur INSIDE the comment; a
    // signature-only scan would lock onto them and misparse. The parser
    // requires the candidate record to point at a real central directory.
    const zip = buildZip([{ name: "a.md", content: "a" }], {
      comment: "x PK\x05\x06 y padding padding padding",
    });
    const entries = parseZipStructure(zip);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.name).toBe("a.md");
  });

  it("parses a genuinely empty archive to zero entries", () => {
    const zip = buildZip([]);
    expect(parseZipStructure(zip)).toEqual([]);
  });

  it("throws when the central directory and EOCD are missing (truncated download)", () => {
    const zip = buildZip([{ name: "a.md", content: "a" }], { omitCentralDirectory: true });
    expect(() => parseZipStructure(zip)).toThrow("no end-of-central-directory record found");
  });

  it("throws on a corrupted central directory record", () => {
    const zip = buildZip([{ name: "a.md", content: "a" }]);
    // The EOCD's central-directory-offset field (u32 at EOCD+16) locates the
    // record; corrupt the record's signature byte behind it. The EOCD scan
    // then rejects the record (directoryLooksReal fails) and no other valid
    // EOCD exists.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocdPos = zip.length - 22; // no comment in this fixture
    const cdOffset = view.getUint32(eocdPos + 16, true);
    zip[cdOffset] = 0x00;
    expect(() => parseZipStructure(zip)).toThrow("no end-of-central-directory record found");
  });

  it("exposes versionMadeBy and externalAttributes verbatim for policy layers", () => {
    // A Unix-creator entry carrying a POSIX mode in the attribute high bits
    // (0o120777 = a symlink) — the raw facts the server's safearchive-parity
    // pre-filter decodes. The structural layer must not interpret them.
    const symlinkMode = (0o120777 << 16) >>> 0;
    const zip = buildZip([
      {
        name: "link",
        content: "target",
        versionMadeBy: 0x0314, // high byte 3 = Unix, low byte 20
        externalAttributes: symlinkMode,
      },
      { name: "plain.md", content: "plain" },
    ]);

    const entries = parseZipStructure(zip);
    expect(entries[0]!.versionMadeBy).toBe(0x0314);
    expect(entries[0]!.externalAttributes).toBe(symlinkMode);
    expect(entries[1]!.versionMadeBy).toBe(20);
    expect(entries[1]!.externalAttributes).toBe(0);
  });
});
