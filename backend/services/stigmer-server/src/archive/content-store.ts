/**
 * The content-addressed archive store — a domain port over the one
 * ArtifactStorage blob driver: keys are `<prefix><sha256>.zip`, writes are
 * once and never garbage-collected (historical versions stay downloadable
 * through the keys a version history exposes), and a key that addresses
 * nothing inside the store collapses to one not-found before the driver
 * sees it. Skills and plugins need the identical port under different
 * prefixes, so the implementation lives here and each domain names its
 * instance (`skills/`, `plugins/`).
 *
 * Why the traversal guard is the port's, not the driver's: a
 * client-supplied storage key that resolves outside the store must read
 * exactly like a missing file — the driver's own containment refusal is a
 * distinguishable error, and distinguishing them would tell a probing
 * caller which escapes exist. Lexical, against a fixed virtual root, so
 * the judgment is identical on every backend.
 *
 * Key shape: a LITERAL forward-slash join, never path.join — the key is a
 * wire-visible identifier (status.artifact_storage_key, download URLs, the
 * lane's prefix check), and on Windows path.join would mint backslash
 * keys.
 *
 * Beside each archive, an indexed store (skills, plugins) keeps the
 * archive's table of contents (`file-index.ts`) under
 * `<indexPrefix><sha256>.json`: a pure function of the archive, written
 * once like it. The store moves its bytes and nothing else; the format is
 * the index module's. Evals keep none.
 *
 * Proven by the skill store's __tests__/artifact-storage.test.ts (the
 * `skills/` instance) and by __tests__/content-store.test.ts.
 */
import path from "node:path";

import type { ArtifactStorage } from "../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../artifactstorage/artifact-storage.js";

/**
 * Storage abstraction for content-addressed archives. The interface exists
 * because the blob backend varies (local disk, an S3 bucket) behind the identical
 * surface, and a controller must not know which one it holds.
 */
export interface ContentAddressedArchiveStore {
  /** Saves an archive under its content hash; returns the storage key. */
  store(hash: string, data: Uint8Array): Promise<string>;
  /** Loads an archive by storage key; throws ArtifactNotFoundError if absent. */
  get(storageKey: string): Promise<Uint8Array>;
  /** Whether an archive with this content hash already exists (dedupe). */
  exists(hash: string): Promise<boolean>;
  /** The storage key for a hash, without storing ("<prefix><hash>.zip"). */
  getStorageKey(hash: string): string;
  /** The stored archive's byte size via stat — never loads content. */
  size(storageKey: string): Promise<number>;
}

/**
 * The store of a kind whose archives are read one file at a time (skills,
 * plugins): ranged reads, and each archive's index beside it.
 */
export interface IndexedArchiveStore extends ContentAddressedArchiveStore {
  /**
   * At most `length` bytes of a stored archive from `offset`, fewer at its
   * end, without loading the rest when the driver reads ranges (both
   * built-in drivers do); a driver without ranged reads loads the archive
   * and takes the slice. Throws ArtifactNotFoundError as `get` does.
   */
  readRange(storageKey: string, offset: number, length: number): Promise<Uint8Array>;
  /** The stored index of the archive with this hash; `undefined` when none is stored yet. */
  loadIndex(hash: string): Promise<Uint8Array | undefined>;
  /** Saves the index of the archive with this hash (write-once, like the archive). */
  storeIndex(hash: string, data: Uint8Array): Promise<void>;
}

/**
 * A storage key that addresses nothing inside the store — missing file OR
 * a traversal-shaped key (both render as "artifact not found: <key>").
 */
export class ArtifactNotFoundError extends Error {
  constructor(storageKey: string) {
    super(`artifact not found: ${storageKey}`);
    this.name = "ArtifactNotFoundError";
  }
}

/** Archives are zip files; the driver stores the honest type. */
const ARCHIVE_CONTENT_TYPE = "application/zip";

/** An index is a JSON document (`file-index.ts`). */
const INDEX_CONTENT_TYPE = "application/json";

/** The fixed virtual root a storage key is judged against (the header's traversal guard). */
const VIRTUAL_ROOT = path.resolve(path.sep, "archive-store");

/** Whether a storage key resolves outside the store: it then reads exactly like a missing archive. */
function keyEscapesStore(storageKey: string): boolean {
  const resolved = path.resolve(VIRTUAL_ROOT, storageKey);
  return resolved !== VIRTUAL_ROOT && !resolved.startsWith(VIRTUAL_ROOT + path.sep);
}

/**
 * The store over a blob driver. Object-literal factory rather than a class:
 * all state is the captured driver and prefix, and the seam-adapter shape
 * matches runner-credential-provider.ts (the house style for ports).
 *
 * `keyPrefix` ends with a slash (`skills/`); it is also the download lane's
 * containment prefix, so the two agree by construction.
 */
export function newContentAddressedArchiveStore(
  driver: ArtifactStorage,
  keyPrefix: string,
): ContentAddressedArchiveStore {
  return {
    getStorageKey(hash: string): string {
      return `${keyPrefix}${hash}.zip`;
    },

    async store(hash: string, data: Uint8Array): Promise<string> {
      const storageKey = this.getStorageKey(hash);
      await driver.upload(storageKey, data, ARCHIVE_CONTENT_TYPE);
      return storageKey;
    },

    async get(storageKey: string): Promise<Uint8Array> {
      if (keyEscapesStore(storageKey)) {
        throw new ArtifactNotFoundError(storageKey);
      }
      try {
        return await driver.download(storageKey);
      } catch (error) {
        if (error instanceof ArtifactStorageNotFoundError) {
          throw new ArtifactNotFoundError(storageKey);
        }
        throw new Error(
          `failed to read artifact: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },

    async exists(hash: string): Promise<boolean> {
      return driver.exists(this.getStorageKey(hash));
    },

    async size(storageKey: string): Promise<number> {
      if (keyEscapesStore(storageKey)) {
        throw new ArtifactNotFoundError(storageKey);
      }
      try {
        return await driver.size(storageKey);
      } catch (error) {
        if (error instanceof ArtifactStorageNotFoundError) {
          throw new ArtifactNotFoundError(storageKey);
        }
        throw new Error(
          `failed to stat artifact: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

/**
 * The indexed store over a blob driver: the content-addressed store under
 * `keyPrefix`, with ranged reads and each archive's index under
 * `indexPrefix`. `indexPrefix` ends with a slash and lies outside every
 * download lane's prefix (`skill-indexes/v1/`), so no storage key a client
 * presents reaches an index.
 */
export function newIndexedArchiveStore(
  driver: ArtifactStorage,
  keyPrefix: string,
  indexPrefix: string,
): IndexedArchiveStore {
  const base = newContentAddressedArchiveStore(driver, keyPrefix);
  const indexKey = (hash: string): string => `${indexPrefix}${hash}.json`;

  return {
    ...base,
    async readRange(storageKey: string, offset: number, length: number): Promise<Uint8Array> {
      if (keyEscapesStore(storageKey)) {
        throw new ArtifactNotFoundError(storageKey);
      }
      try {
        if (driver.readRange !== undefined) {
          return await driver.readRange(storageKey, offset, length);
        }
        // A registered driver without ranged reads: the whole archive, cut.
        return (await driver.download(storageKey)).slice(offset, offset + length);
      } catch (error) {
        if (error instanceof ArtifactStorageNotFoundError) {
          throw new ArtifactNotFoundError(storageKey);
        }
        throw new Error(
          `failed to read artifact: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },

    async loadIndex(hash: string): Promise<Uint8Array | undefined> {
      try {
        return await driver.download(indexKey(hash));
      } catch (error) {
        if (error instanceof ArtifactStorageNotFoundError) {
          return undefined;
        }
        throw error;
      }
    },

    async storeIndex(hash: string, data: Uint8Array): Promise<void> {
      await driver.upload(indexKey(hash), data, INDEX_CONTENT_TYPE);
    },
  };
}
