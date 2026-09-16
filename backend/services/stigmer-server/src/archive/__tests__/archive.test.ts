/**
 * Pins the shared archive plumbing on its own, apart from the skill gate
 * that composes it: the structural walk's sentences and their order, the
 * capped inflate's typed outcomes, the writer's determinism (the same
 * files twice are byte-equal, entry order is irrelevant, the result reads
 * back through the server's own reader), and the content-addressed
 * store's key shape and traversal collapse under a second prefix. The
 * skill gate's zip-gate.test.ts proves the composition keeps its pinned
 * copy; this file proves the pieces a plugin builds on.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { parseZipStructure } from "@stigmer/zip-structure";
import { buildZip } from "@stigmer/zip-structure/testing";

import { LocalArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import {
  ArtifactNotFoundError,
  newContentAddressedArchiveStore,
} from "../content-store.js";
import { InflateError, inflateEntry } from "../inflate.js";
import { PLATFORM_ARCHIVE_LIMITS } from "../limits.js";
import {
  calculateHash,
  openArchive,
  validateArchiveStructure,
} from "../open.js";
import { writeArchive } from "../write.js";

const encoder = new TextEncoder();

describe("openArchive", () => {
  it("hashes the bytes and pre-filters the entries", () => {
    const zip = buildZip([{ name: "./a/../plugin.json", content: "{}" }]);
    const opened = openArchive(zip);
    expect(opened.hash).toBe(calculateHash(zip));
    expect(opened.entries.map((e) => e.name)).toEqual(["plugin.json"]);
  });

  it("refuses an over-limit archive before parsing, naming the limit", () => {
    expect(() => openArchive(new Uint8Array(11), 10)).toThrow(
      "ZIP file too large: 11 bytes (max: 10)",
    );
  });

  it("refuses bytes that are not a zip with the stdlib text", () => {
    expect(() => openArchive(encoder.encode("not a zip"))).toThrow(
      "invalid ZIP file: zip: not a valid zip file",
    );
  });
});

describe("validateArchiveStructure", () => {
  it("refuses an empty archive first", () => {
    expect(() => validateArchiveStructure([], PLATFORM_ARCHIVE_LIMITS)).toThrow(
      "ZIP file is empty",
    );
  });

  it("refuses too many files, then a control character, then the budget", () => {
    const one = openArchive(buildZip([{ name: "a", content: "x" }])).entries;
    expect(() =>
      validateArchiveStructure(one, {
        ...PLATFORM_ARCHIVE_LIMITS,
        maxFiles: 0,
      }),
    ).toThrow("too many files in ZIP: 1 (max: 0)");

    const control = openArchive(
      buildZip([{ name: "bad\u0001name", content: "x" }]),
    ).entries;
    expect(() =>
      validateArchiveStructure(control, PLATFORM_ARCHIVE_LIMITS),
    ).toThrow("invalid character in filename: bad\u0001name");

    const big = openArchive(
      buildZip([{ name: "a", content: "x".repeat(64) }]),
    ).entries;
    expect(() =>
      validateArchiveStructure(big, {
        ...PLATFORM_ARCHIVE_LIMITS,
        maxUncompressedSize: 10,
      }),
    ).toThrow("total uncompressed size too large: 64 bytes (max: 10)");
  });

  it("hands every sanitised name to the observer in order", () => {
    const entries = openArchive(
      buildZip([
        { name: "skills/x/SKILL.md", content: "---\nname: x\n---" },
        { name: "plugin.json", content: "{}" },
      ]),
    ).entries;
    const seen: string[] = [];
    validateArchiveStructure(entries, PLATFORM_ARCHIVE_LIMITS, (name) =>
      seen.push(name),
    );
    expect(seen).toEqual(["skills/x/SKILL.md", "plugin.json"]);
  });
});

describe("inflateEntry", () => {
  it("returns stored and deflated payloads under the cap", () => {
    const zip = buildZip([
      { name: "s", content: "stored" },
      { name: "d", content: "deflated".repeat(20), method: "deflated" },
    ]);
    const [stored, deflated] = parseZipStructure(zip);
    expect(new TextDecoder().decode(inflateEntry(stored!, 1024))).toBe(
      "stored",
    );
    expect(new TextDecoder().decode(inflateEntry(deflated!, 1024))).toBe(
      "deflated".repeat(20),
    );
  });

  it("refuses output past the cap as too-large, judged on the real bytes", () => {
    const zip = buildZip([
      { name: "d", content: "a".repeat(4096), method: "deflated" },
    ]);
    const [entry] = parseZipStructure(zip);
    let failure: InflateError | undefined;
    try {
      inflateEntry(entry!, 100);
    } catch (error) {
      failure = error instanceof InflateError ? error : undefined;
    }
    expect(failure?.kind).toBe("too-large");
  });

  it("refuses a corrupt payload as a checksum failure", () => {
    const zip = buildZip([{ name: "s", content: "hello" }]);
    const [entry] = parseZipStructure(zip);
    const corrupted = { ...entry!, compressedData: encoder.encode("jello") };
    let failure: InflateError | undefined;
    try {
      inflateEntry(corrupted, 1024);
    } catch (error) {
      failure = error instanceof InflateError ? error : undefined;
    }
    expect(failure?.kind).toBe("checksum");
    expect(failure?.detail).toBe("zip: checksum error");
  });

  it("refuses a compression method the platform does not register", () => {
    const zip = buildZip([{ name: "s", content: "hello" }]);
    const [entry] = parseZipStructure(zip);
    const bzip2 = { ...entry!, compressionMethod: 12 };
    expect(() => inflateEntry(bzip2, 1024)).toThrow(
      "unsupported-method: zip: unsupported compression algorithm",
    );
  });
});

describe("writeArchive", () => {
  const files = [
    {
      path: "skills/x/SKILL.md",
      bytes: encoder.encode("---\nname: x\n---\nbody"),
    },
    { path: "plugin.json", bytes: encoder.encode('{"name":"x"}') },
  ];

  it("is byte-deterministic and independent of entry order", () => {
    const first = writeArchive(files);
    const second = writeArchive([...files].reverse());
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(calculateHash(first)).toBe(calculateHash(second));
  });

  it("round-trips through the server's own reader", () => {
    const opened = openArchive(writeArchive(files));
    expect(opened.entries.map((e) => e.name)).toEqual([
      "plugin.json",
      "skills/x/SKILL.md",
    ]);
    const skill = opened.entries.find((e) => e.name === "skills/x/SKILL.md")!;
    expect(new TextDecoder().decode(inflateEntry(skill.entry, 1024))).toBe(
      "---\nname: x\n---\nbody",
    );
  });

  it("refuses a path listed twice", () => {
    expect(() => writeArchive([files[0]!, files[0]!])).toThrow(
      "archive path 'skills/x/SKILL.md' listed twice",
    );
  });
});

describe("newContentAddressedArchiveStore", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "archive-store-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keys under its prefix and round-trips bytes", async () => {
    const store = newContentAddressedArchiveStore(
      new LocalArtifactStorage(dir, ""),
      "plugins/",
    );
    const hash = "a".repeat(64);
    expect(store.getStorageKey(hash)).toBe(`plugins/${hash}.zip`);
    expect(await store.exists(hash)).toBe(false);
    const key = await store.store(hash, encoder.encode("zip"));
    expect(key).toBe(`plugins/${hash}.zip`);
    expect(await store.exists(hash)).toBe(true);
    expect(new TextDecoder().decode(await store.get(key))).toBe("zip");
    expect(await store.size(key)).toBe(3);
  });

  it("collapses a traversal-shaped key and a missing key to one not-found", async () => {
    const store = newContentAddressedArchiveStore(
      new LocalArtifactStorage(dir, ""),
      "plugins/",
    );
    await expect(store.get("../../etc/passwd")).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
    await expect(store.get("plugins/missing.zip")).rejects.toBeInstanceOf(
      ArtifactNotFoundError,
    );
    await expect(store.size("../x")).rejects.toThrow(
      "artifact not found: ../x",
    );
  });
});
