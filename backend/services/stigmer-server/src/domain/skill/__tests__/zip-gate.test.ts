/**
 * Pins the ZIP gate against Go's zip_extractor_test.go arms plus the
 * DD-001 pre-filter integration: every rejection message byte-for-byte
 * where the text is static, prefix-matched where it embeds sizes.
 */
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { buildZip } from "@stigmer/zip-structure/testing";

import { MAX_SKILL_MD_SIZE, MAX_ZIP_SIZE } from "../constants.js";
import { calculateHash, extractSkillMd } from "../storage/zip-gate.js";

const VALID_SKILL_MD = "---\nname: test-skill\ndescription: A test\n---\n# Test";

function validZip(): Uint8Array {
  return buildZip([
    { name: "SKILL.md", content: VALID_SKILL_MD },
    { name: "references/schema.md", content: "tables" },
  ]);
}

describe("extractSkillMd — happy path", () => {
  it("extracts content, identity, and the content-addressed hash", () => {
    const zip = validZip();
    const result = extractSkillMd(zip);
    expect(result.content).toBe(VALID_SKILL_MD);
    expect(result.name).toBe("test-skill");
    expect(result.description).toBe("A test");
    expect(result.hash).toBe(calculateHash(zip));
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("reads a deflated SKILL.md", () => {
    const zip = buildZip([
      { name: "SKILL.md", content: VALID_SKILL_MD, method: "deflated" },
    ]);
    expect(extractSkillMd(zip).name).toBe("test-skill");
  });

  it("reads a streaming-style archive (Go zip writer default)", () => {
    const zip = buildZip([
      { name: "SKILL.md", content: VALID_SKILL_MD, streaming: true },
    ]);
    expect(extractSkillMd(zip).name).toBe("test-skill");
  });

  it("accepts a traversal-named SKILL.md — safearchive sanitizes it to root (DD-001)", () => {
    const zip = buildZip([{ name: "../SKILL.md", content: VALID_SKILL_MD }]);
    expect(extractSkillMd(zip).name).toBe("test-skill");
  });
});

describe("extractSkillMd — rejection arms (Go validateZipContent order)", () => {
  it("rejects an over-limit archive before parsing", () => {
    // A sparse Uint8Array is enough — the size check runs first.
    const oversized = new Uint8Array(MAX_ZIP_SIZE + 1);
    expect(() => extractSkillMd(oversized)).toThrow(
      `ZIP file too large: ${MAX_ZIP_SIZE + 1} bytes (max: ${MAX_ZIP_SIZE})`,
    );
  });

  it("rejects non-ZIP bytes with Go's stdlib text", () => {
    expect(() => extractSkillMd(new TextEncoder().encode("not a zip"))).toThrow(
      "invalid ZIP file: zip: not a valid zip file",
    );
  });

  it("rejects an empty archive", () => {
    expect(() => extractSkillMd(buildZip([]))).toThrow("ZIP file is empty");
  });

  it("rejects an archive whose only entries the pre-filter dropped as empty", () => {
    const zip = buildZip([{ name: "DOWNLO~1/only.txt", content: "x" }]);
    expect(() => extractSkillMd(zip)).toThrow("ZIP file is empty");
  });

  it("rejects control characters in entry names", () => {
    const zip = buildZip([
      { name: "SKILL.md", content: VALID_SKILL_MD },
      { name: "bad\u0001name.txt", content: "x" },
    ]);
    expect(() => extractSkillMd(zip)).toThrow("invalid character in filename: bad\u0001name.txt");
  });

  it("rejects a suspicious per-file compression ratio", () => {
    // Highly compressible: 200KB of zeros deflates far below 2KB.
    const bomb = new Uint8Array(200 * 1024);
    const zip = buildZip([
      { name: "SKILL.md", content: VALID_SKILL_MD },
      { name: "bomb.bin", content: bomb, method: "deflated" },
    ]);
    expect(() => extractSkillMd(zip)).toThrow(/^suspicious compression ratio in bomb\.bin: \d+:1 \(max: 100:1\)$/);
  });

  it("rejects an over-budget declared-uncompressed total (fail-fast on the crossing entry)", () => {
    // Two stored entries declaring 300MB each over 3MB payloads: ratio is
    // exactly 100 (not > 100, passes), and the running total crosses the
    // 500MB budget on the second entry — the arm under test.
    const payload = new Uint8Array(3 * 1024 * 1024);
    const declared = 300 * 1024 * 1024;
    const zip = buildZip([
      { name: "SKILL.md", content: VALID_SKILL_MD },
      { name: "a.bin", content: payload, declaredUncompressedSize: declared },
      { name: "b.bin", content: payload, declaredUncompressedSize: declared },
    ]);
    expect(() => extractSkillMd(zip)).toThrow(
      /^total uncompressed size too large: \d+ bytes \(max: 524288000\)$/,
    );
  });

  it("rejects a missing SKILL.md", () => {
    const zip = buildZip([{ name: "README.md", content: "no skill here" }]);
    expect(() => extractSkillMd(zip)).toThrow("SKILL.md not found in ZIP archive");
  });

  it("rejects a nested-only SKILL.md with the #452 hint", () => {
    const zip = buildZip([{ name: "my-skill/SKILL.md", content: VALID_SKILL_MD }]);
    expect(() => extractSkillMd(zip)).toThrow(
      "SKILL.md must be at the archive root — zip the skill folder's contents, not the folder itself",
    );
  });

  it("rejects an empty SKILL.md", () => {
    const zip = buildZip([{ name: "SKILL.md", content: "" }]);
    expect(() => extractSkillMd(zip)).toThrow("SKILL.md is empty");
  });

  it("rejects an over-cap stored SKILL.md", () => {
    // Stored (no compression) so the ratio check cannot fire first; the
    // declared total stays under the 500MB budget.
    const huge = new Uint8Array(MAX_SKILL_MD_SIZE + 1).fill(0x61);
    const zip = buildZip([{ name: "SKILL.md", content: huge }]);
    expect(() => extractSkillMd(zip)).toThrow(
      `SKILL.md too large (max: ${MAX_SKILL_MD_SIZE} bytes)`,
    );
  });

  it("rejects a SKILL.md whose ACTUAL inflation exceeds the cap while its declaration lies small", () => {
    // The declaration-based checks (total budget, ratio) see a small lie;
    // only bounding the actual inflated output catches it. Incompressible
    // (seeded-PRNG) content keeps the declared ratio honest-looking.
    const big = new Uint8Array(2 * 1024 * 1024);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < big.length; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      big[i] = seed & 0xff;
    }
    const zip = buildZip([
      {
        name: "SKILL.md",
        content: big,
        method: "deflated",
        declaredUncompressedSize: 20_000,
      },
    ]);
    expect(() => extractSkillMd(zip)).toThrow(
      `SKILL.md too large (max: ${MAX_SKILL_MD_SIZE} bytes)`,
    );
  });

  it("rejects a checksum mismatch with Go's stdlib text", () => {
    // Corrupt one payload byte after building; the CD's CRC then disagrees
    // with the stored content.
    const zip = buildZip([{ name: "SKILL.md", content: VALID_SKILL_MD }]);
    // Local header (30) + name (8) = payload start for the first entry.
    const payloadStart = 30 + "SKILL.md".length;
    zip[payloadStart] = zip[payloadStart]! ^ 0xff;
    expect(() => extractSkillMd(zip)).toThrow(
      "failed to read SKILL.md: zip: checksum error",
    );
  });

  it("rejects an unsupported compression method with Go's stdlib text", () => {
    const zip = buildZip([{ name: "SKILL.md", content: VALID_SKILL_MD }]);
    // Rewrite the method field (bzip2 = 12) in BOTH the local header and
    // the central directory record.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    view.setUint16(8, 12, true); // local header method @ offset 8
    const eocdPos = zip.length - 22;
    const cdOffset = view.getUint32(eocdPos + 16, true);
    view.setUint16(cdOffset + 10, 12, true); // CD method @ +10
    expect(() => extractSkillMd(zip)).toThrow(
      "failed to open SKILL.md: zip: unsupported compression algorithm",
    );
  });

  it("wraps frontmatter failures with Go's prefix", () => {
    const zip = buildZip([{ name: "SKILL.md", content: "# no frontmatter" }]);
    expect(() => extractSkillMd(zip)).toThrow(
      /^invalid SKILL\.md frontmatter: SKILL\.md must start with YAML frontmatter/,
    );
  });
});
