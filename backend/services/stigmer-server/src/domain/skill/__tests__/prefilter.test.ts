/**
 * Pins the safearchive-parity pre-filter (DD-001) against the behaviors
 * read from safearchive's source at the go.mod-pinned version: sanitizer
 * tests (sanitizer_nix_test.go), applyMagic's skip/shadow order, and the
 * archive/zip mode-decode rules. Fixtures are byte-crafted with the shared
 * builder so entry attributes are exactly what a real archive carries.
 */
import { describe, expect, it } from "vitest";

import { parseZipStructure } from "@stigmer/zip-structure";
import { buildZip } from "@stigmer/zip-structure/testing";

import {
  applyEntryPrefilter,
  entryTypeBits,
  hasWindowsShortFilenames,
  sanitizePath,
} from "../storage/prefilter.js";

// versionMadeBy high byte 3 = Unix creator; POSIX mode rides the attribute
// high 16 bits (how zip writers encode symlinks and special files).
const UNIX_CREATOR = 0x0314;
const symlinkAttrs = (0o120777 << 16) >>> 0;
const charDeviceAttrs = (0o020644 << 16) >>> 0;
const fifoAttrs = (0o010644 << 16) >>> 0;
const regularAttrs = (0o100644 << 16) >>> 0;

describe("sanitizePath (safearchive sanitizer.SanitizePath)", () => {
  // Table from sanitizer_nix_test.go plus the arms the gate leans on.
  const cases: Array<[string, string]> = [
    ["some/thing", "some/thing"],
    ["../../some/thing", "some/thing"],
    ["..\\..\\some\\thing", "some/thing"],
    ["/rooted/path", "rooted/path"],
    ["../SKILL.md", "SKILL.md"],
    ["a/../b", "b"],
    ["a//b", "a/b"],
    ["a/./b", "a/b"],
    ["..", ""],
    ["/", ""],
    ["", ""],
  ];
  for (const [input, expected] of cases) {
    it(`sanitizes ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(sanitizePath(input)).toBe(expected);
    });
  }

  it("preserves a trailing separator when the result is non-empty", () => {
    expect(sanitizePath("dir/")).toBe("dir/");
    expect(sanitizePath("..\\dir\\")).toBe("dir/");
    expect(sanitizePath("/")).toBe("");
  });
});

describe("hasWindowsShortFilenames", () => {
  it("detects 8.3-style markers in any path component", () => {
    expect(hasWindowsShortFilenames("DOWNLO~1/file.txt")).toBe(true);
    expect(hasWindowsShortFilenames("dir/FOOOOO~1.JPG")).toBe(true);
    expect(hasWindowsShortFilenames("dir\\1(3)~1.PNG")).toBe(true);
  });

  it("passes ordinary names, including tildes without digits", () => {
    expect(hasWindowsShortFilenames("references/schema.md")).toBe(false);
    expect(hasWindowsShortFilenames("notes~draft.md")).toBe(false);
  });
});

describe("entryTypeBits (archive/zip FileHeader.Mode decode)", () => {
  function entryWith(versionMadeBy: number, externalAttributes: number) {
    const zip = buildZip([
      { name: "x", content: "x", versionMadeBy, externalAttributes },
    ]);
    return parseZipStructure(zip)[0]!;
  }

  it("decodes Unix symlink and special-file types", () => {
    expect(entryTypeBits(entryWith(UNIX_CREATOR, symlinkAttrs))).toEqual({
      isSymlink: true,
      isSpecial: false,
    });
    expect(entryTypeBits(entryWith(UNIX_CREATOR, charDeviceAttrs))).toEqual({
      isSymlink: false,
      isSpecial: true,
    });
    expect(entryTypeBits(entryWith(UNIX_CREATOR, fifoAttrs))).toEqual({
      isSymlink: false,
      isSpecial: true,
    });
    expect(entryTypeBits(entryWith(UNIX_CREATOR, regularAttrs))).toEqual({
      isSymlink: false,
      isSpecial: false,
    });
  });

  it("never decodes symlink/special for FAT creators — MSDOS attrs cannot express them", () => {
    // The same attribute BITS under a FAT creator (versionMadeBy 20) are
    // FAT attributes, not a POSIX mode.
    expect(entryTypeBits(entryWith(20, symlinkAttrs))).toEqual({
      isSymlink: false,
      isSpecial: false,
    });
  });
});

describe("applyEntryPrefilter (safearchive applyMagic)", () => {
  it("sanitizes names — a traversal-shaped SKILL.md becomes root SKILL.md", () => {
    const zip = buildZip([{ name: "../SKILL.md", content: "# via traversal" }]);
    const filtered = applyEntryPrefilter(parseZipStructure(zip));
    expect(filtered.map((f) => f.name)).toEqual(["SKILL.md"]);
  });

  it("drops entries with Windows 8.3-style components", () => {
    const zip = buildZip([
      { name: "SKILL.md", content: "# ok" },
      { name: "DOWNLO~1/asset.png", content: "x" },
    ]);
    const filtered = applyEntryPrefilter(parseZipStructure(zip));
    expect(filtered.map((f) => f.name)).toEqual(["SKILL.md"]);
  });

  it("drops entries shadowed by an earlier symlink, case-insensitively; the symlink entry itself stays", () => {
    const zip = buildZip([
      {
        name: "Link",
        content: "target",
        versionMadeBy: UNIX_CREATOR,
        externalAttributes: symlinkAttrs,
      },
      { name: "link/inside.txt", content: "smuggled" },
      { name: "safe/file.txt", content: "ok" },
    ]);
    const filtered = applyEntryPrefilter(parseZipStructure(zip));
    expect(filtered.map((f) => f.name)).toEqual(["Link", "safe/file.txt"]);
  });

  it("drops special-file entries (devices, pipes)", () => {
    const zip = buildZip([
      { name: "SKILL.md", content: "# ok" },
      {
        name: "dev-node",
        content: "",
        versionMadeBy: UNIX_CREATOR,
        externalAttributes: charDeviceAttrs,
      },
    ]);
    const filtered = applyEntryPrefilter(parseZipStructure(zip));
    expect(filtered.map((f) => f.name)).toEqual(["SKILL.md"]);
  });

  it("keeps regular Unix-creator entries untouched", () => {
    const zip = buildZip([
      {
        name: "SKILL.md",
        content: "# ok",
        versionMadeBy: UNIX_CREATOR,
        externalAttributes: regularAttrs,
      },
    ]);
    const filtered = applyEntryPrefilter(parseZipStructure(zip));
    expect(filtered.map((f) => f.name)).toEqual(["SKILL.md"]);
  });
});
