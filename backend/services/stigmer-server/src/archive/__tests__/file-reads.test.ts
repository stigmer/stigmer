/**
 * One file read alone: the index loaded once and cached, built from the
 * archive on first read when none is stored (once, for concurrent
 * readers), and a read that moves only the file's own stored bytes.
 */
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";
import { buildZip } from "@stigmer/zip-structure/testing";

import type { ArtifactStorage } from "../../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../../artifactstorage/artifact-storage.js";
import { createLogger } from "../../boot/logger.js";
import { ArtifactNotFoundError, newIndexedArchiveStore } from "../content-store.js";
import { encodeArchiveFileIndex, buildArchiveFileIndex, fileIndexKeyPrefix } from "../file-index.js";
import { newArchiveFileReads, storeIndexAtPush } from "../file-reads.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

interface Counts {
  downloads: string[];
  ranges: Array<{ key: string; length: number }>;
  uploads: string[];
}

/** An in-memory driver that counts what it is asked. */
function countingDriver(blobs = new Map<string, Uint8Array>()): { driver: ArtifactStorage; counts: Counts; blobs: Map<string, Uint8Array> } {
  const counts: Counts = { downloads: [], ranges: [], uploads: [] };
  const missing = (key: string): never => {
    throw new ArtifactStorageNotFoundError(key);
  };
  const driver = {
    upload: async (key: string, data: Uint8Array) => {
      counts.uploads.push(key);
      blobs.set(key, data);
    },
    download: async (key: string) => {
      counts.downloads.push(key);
      return blobs.get(key) ?? missing(key);
    },
    size: async (key: string) => (blobs.get(key) ?? missing(key)).length,
    readRange: async (key: string, offset: number, length: number) => {
      counts.ranges.push({ key, length });
      return (blobs.get(key) ?? missing(key)).slice(offset, offset + length);
    },
  } as unknown as ArtifactStorage;
  return { driver, counts, blobs };
}

const filler = (size: number): string => {
  let out = "";
  let seed = 7;
  while (out.length < size) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    out += String.fromCharCode(33 + (seed % 90));
  }
  return out;
};

function pushed(): { bytes: Uint8Array; hash: string; key: string } {
  const bytes = buildZip([
    { name: "SKILL.md", content: "# Skill" },
    { name: "references/big.txt", content: filler(200_000) },
    { name: "references/small.md", content: "small file", method: "deflated" },
  ]);
  const hash = createHash("sha256").update(bytes).digest("hex");
  return { bytes, hash, key: `skills/${hash}.zip` };
}

describe("newArchiveFileReads", () => {
  it("reads one file by its stored range alone, not the archive", async () => {
    const { bytes, hash, key } = pushed();
    const { driver, counts } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(driver, "skills/", fileIndexKeyPrefix("skill"));
    await store.storeIndex(hash, encodeArchiveFileIndex(buildArchiveFileIndex(bytes, "skill")));
    const reads = newArchiveFileReads(store, "skill", silentLogger);

    const index = await reads.index(hash, key);
    const small = index.files.find((file) => file.path === "references/small.md")!;
    expect(new TextDecoder().decode(await reads.read(key, small))).toBe("small file");

    expect(counts.downloads).toEqual([`skill-indexes/v1/${hash}.json`]);
    expect(counts.ranges).toEqual([{ key, length: small.storedSize }]);
    expect(small.storedSize).toBeLessThan(100);
    expect(bytes.length).toBeGreaterThan(100_000);
  });

  it("keeps a loaded index, so the next read costs one ranged read", async () => {
    const { bytes, hash, key } = pushed();
    const { driver, counts } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(driver, "skills/", fileIndexKeyPrefix("skill"));
    await storeIndexAtPush(store, "skill", hash, bytes, silentLogger);
    const reads = newArchiveFileReads(store, "skill", silentLogger);
    await reads.index(hash, key);
    await reads.index(hash, key);
    expect(counts.downloads).toHaveLength(1);
  });

  it("builds a missing index from the archive once, for every concurrent reader, and stores it", async () => {
    const { bytes, hash, key } = pushed();
    const { driver, counts, blobs } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(driver, "skills/", fileIndexKeyPrefix("skill"));
    const reads = newArchiveFileReads(store, "skill", silentLogger);

    const [a, b] = await Promise.all([reads.index(hash, key), reads.index(hash, key)]);
    expect(a).toBe(b);
    expect(counts.downloads.filter((k) => k === key)).toHaveLength(1);
    expect(counts.uploads).toEqual([`skill-indexes/v1/${hash}.json`]);
    expect(blobs.has(`skill-indexes/v1/${hash}.json`)).toBe(true);
  });

  it("refuses an archive that does not hash to its version", async () => {
    const { bytes, key } = pushed();
    const { driver } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(driver, "skills/", fileIndexKeyPrefix("skill"));
    const reads = newArchiveFileReads(store, "skill", silentLogger);
    await expect(reads.index("c".repeat(64), key)).rejects.toThrow(/does not hash to its version/);
  });

  it("refuses stored bytes that do not inflate to the file", async () => {
    const { bytes, hash, key } = pushed();
    const { driver, blobs } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(driver, "skills/", fileIndexKeyPrefix("skill"));
    const reads = newArchiveFileReads(store, "skill", silentLogger);
    const index = await reads.index(hash, key);
    const small = index.files.find((file) => file.path === "references/small.md")!;
    const tampered = bytes.slice();
    tampered[small.offset] = tampered[small.offset]! ^ 0xff;
    blobs.set(key, tampered);
    await expect(reads.read(key, small)).rejects.toThrow();
  });
});

describe("newArchiveFileReads under faults", () => {
  it("still answers an index it built but could not store, building it again on the next process's read", async () => {
    const { bytes, hash, key } = pushed();
    const { driver } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(
      { ...driver, upload: () => Promise.reject(new Error("disk full")) } as ArtifactStorage,
      "skills/",
      fileIndexKeyPrefix("skill"),
    );
    const index = await newArchiveFileReads(store, "skill", silentLogger).index(hash, key);
    expect(index.files.map((file) => file.path)).toContain("references/small.md");
  });

  it("refuses a stored archive shorter than its index says", async () => {
    const { bytes, hash, key } = pushed();
    const { driver, blobs } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(driver, "skills/", fileIndexKeyPrefix("skill"));
    const reads = newArchiveFileReads(store, "skill", silentLogger);
    const index = await reads.index(hash, key);
    blobs.set(key, bytes.subarray(0, 64));
    const small = index.files.find((file) => file.path === "references/small.md")!;
    await expect(reads.read(key, small)).rejects.toThrow(/shorter than its index says/);
  });
});

describe("the indexed store's ranged read", () => {
  const archive = new TextEncoder().encode("0123456789");

  it("reads a range on a driver that has none by loading the archive and cutting it", async () => {
    const { driver } = countingDriver(new Map([["skills/a.zip", archive]]));
    const plain = { ...driver, readRange: undefined } as ArtifactStorage;
    const store = newIndexedArchiveStore(plain, "skills/", fileIndexKeyPrefix("skill"));
    expect(new TextDecoder().decode(await store.readRange("skills/a.zip", 2, 3))).toBe("234");
  });

  it("answers a key outside the store or a missing archive as not found, and any other fault as a failed read", async () => {
    const { driver } = countingDriver();
    const store = newIndexedArchiveStore(driver, "skills/", fileIndexKeyPrefix("skill"));
    await expect(store.readRange("../../etc/passwd", 0, 1)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    await expect(store.readRange("skills/missing.zip", 0, 1)).rejects.toBeInstanceOf(ArtifactNotFoundError);
    const broken = newIndexedArchiveStore(
      { ...driver, readRange: () => Promise.reject(new Error("EIO")), download: () => Promise.reject(new Error("EIO")) } as ArtifactStorage,
      "skills/",
      fileIndexKeyPrefix("skill"),
    );
    await expect(broken.readRange("skills/a.zip", 0, 1)).rejects.toThrow("failed to read artifact: EIO");
    await expect(broken.loadIndex("a".repeat(64))).rejects.toThrow("EIO");
  });
});

describe("storeIndexAtPush", () => {
  it("never fails the push over an index it cannot store", async () => {
    const { bytes, hash, key } = pushed();
    const { driver } = countingDriver(new Map([[key, bytes]]));
    const store = newIndexedArchiveStore(
      { ...driver, upload: () => Promise.reject(new Error("disk full")) } as ArtifactStorage,
      "skills/",
      fileIndexKeyPrefix("skill"),
    );
    await expect(storeIndexAtPush(store, "skill", hash, bytes, silentLogger)).resolves.toBeUndefined();
  });
});
