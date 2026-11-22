/**
 * Reading one file of a stored archive without loading the archive: the
 * archive's index (`file-index.ts`) says where the file's stored bytes sit,
 * the store reads exactly that range (`content-store.ts` `readRange`), and
 * the bytes are inflated under the file's size with their CRC checked.
 * Skills and plugins read the same way, so one reader serves both kinds;
 * each kind's handler decides who may read which version (`file-handlers.ts`).
 *
 * The index is loaded once per version and kept in a small cache bounded by
 * bytes ({@link DEFAULT_INDEX_CACHE_BYTES}), so a read costs one ranged
 * storage read. An index that is not stored yet (a version pushed before
 * indexes existed, or a push whose index write failed) is built from the
 * archive on first read and stored: once per version, with concurrent
 * readers in one process sharing one build. Two servers building at once
 * write the same bytes to the same write-once key, which is harmless.
 *
 * The push writes the index too ({@link storeIndexAtPush}), never failing
 * the push over it: a read rebuilds what a push could not write.
 *
 * Proven by __tests__/file-reads.test.ts.
 */
import { createHash } from "node:crypto";

import { LRUCache } from "lru-cache";
import type { ZipStructuralEntry } from "@stigmer/zip-structure";

import type { Logger } from "../boot/logger.js";
import type { IndexedArchiveStore } from "./content-store.js";
import {
  buildArchiveFileIndex,
  decodeArchiveFileIndex,
  encodeArchiveFileIndex,
} from "./file-index.js";
import type { ArchiveFileEntry, ArchiveFileIndex, IndexedArchiveKind } from "./file-index.js";
import { inflateEntry } from "./inflate.js";

/** The bytes of indexes one server keeps loaded. */
export const DEFAULT_INDEX_CACHE_BYTES = 16 * 1024 * 1024;

/** One kind's file reads over its archive store. */
export interface ArchiveFileReads {
  /**
   * The index of the archive with content hash `hash`, stored at
   * `storageKey`: loaded, or built from the archive and stored. Throws
   * ArtifactNotFoundError when the archive is gone, and a plain Error when
   * the stored archive does not hash to `hash` or cannot be indexed.
   */
  index(hash: string, storageKey: string): Promise<ArchiveFileIndex>;
  /**
   * One file's bytes, read alone: its stored range, inflated under its
   * size, CRC checked. Throws when the range is short or the bytes do not
   * inflate to the file.
   */
  read(storageKey: string, entry: ArchiveFileEntry): Promise<Uint8Array>;
}

export function newArchiveFileReads(
  store: IndexedArchiveStore,
  kind: IndexedArchiveKind,
  logger: Logger,
  cacheBytes: number = DEFAULT_INDEX_CACHE_BYTES,
): ArchiveFileReads {
  const cache = new LRUCache<string, ArchiveFileIndex>({
    maxSize: cacheBytes,
    sizeCalculation: (index) => indexWeight(index),
  });
  const building = new Map<string, Promise<ArchiveFileIndex>>();

  async function loadOrBuild(hash: string, storageKey: string): Promise<ArchiveFileIndex> {
    const stored = await store.loadIndex(hash);
    const decoded = stored === undefined ? undefined : decodeArchiveFileIndex(stored);
    if (decoded !== undefined) return decoded;

    const archive = await store.get(storageKey);
    if (createHash("sha256").update(archive).digest("hex") !== hash) {
      throw new Error(`the stored ${kind} archive at ${storageKey} does not hash to its version ${hash}`);
    }
    const index = buildArchiveFileIndex(archive, kind);
    try {
      await store.storeIndex(hash, encodeArchiveFileIndex(index));
    } catch (error) {
      logger.warn(`${kind} archive index ${hash} was built but could not be stored; the next read builds it again`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return index;
  }

  return {
    async index(hash, storageKey) {
      const cached = cache.get(hash);
      if (cached !== undefined) return cached;
      let pending = building.get(hash);
      if (pending === undefined) {
        pending = loadOrBuild(hash, storageKey).finally(() => building.delete(hash));
        building.set(hash, pending);
      }
      const index = await pending;
      if (indexWeight(index) <= cacheBytes) cache.set(hash, index);
      return index;
    },

    async read(storageKey, entry) {
      const stored = await store.readRange(storageKey, entry.offset, entry.storedSize);
      if (stored.length !== entry.storedSize) {
        throw new Error(`the stored ${kind} archive at ${storageKey} is shorter than its index says`);
      }
      return inflateEntry(structuralEntry(entry, stored), entry.size);
    },
  };
}

/**
 * Builds and stores the index of an archive a push just accepted. Never
 * throws: a failure is logged and the first read builds the index instead.
 */
export async function storeIndexAtPush(
  store: IndexedArchiveStore,
  kind: IndexedArchiveKind,
  hash: string,
  archive: Uint8Array,
  logger: Logger,
): Promise<void> {
  try {
    await store.storeIndex(hash, encodeArchiveFileIndex(buildArchiveFileIndex(archive, kind)));
  } catch (error) {
    logger.warn(`${kind} archive index ${hash} could not be stored at push; the first read builds it`, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The structural record `inflateEntry` reads, rebuilt from an index entry and its stored bytes. */
function structuralEntry(entry: ArchiveFileEntry, compressedData: Uint8Array): ZipStructuralEntry {
  return {
    name: entry.path,
    isDirectory: false,
    compressionMethod: entry.method,
    uncompressedSize: entry.size,
    compressedSize: entry.storedSize,
    crc32: entry.crc32,
    versionMadeBy: 0,
    externalAttributes: 0,
    compressedData,
  };
}

/** What an index weighs in the cache: about what its stored JSON does. */
function indexWeight(index: ArchiveFileIndex): number {
  return index.files.reduce((sum, file) => sum + file.path.length * 2 + 160, 64);
}
