/**
 * The content-addressed archive store — a domain port over the one
 * ArtifactStorage blob driver: keys are `<prefix><sha256>.zip`, writes are
 * once and never garbage-collected (historical versions stay downloadable
 * through the keys a version history exposes), and a key that addresses
 * nothing inside the store collapses to one not-found before the driver
 * sees it. Skills shipped this shape first
 * (pkg/domain/skill/storage/artifact_storage.go, then the TS port under
 * domain/skill/storage); plugins need the identical port under another
 * prefix, so the implementation lives here and each domain names its
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
 * lane's prefix check) and Windows support arrives only through this server
 * (#24); path.join would mint backslash keys there.
 *
 * Proven by the skill store's __tests__/artifact-storage.test.ts (the
 * `skills/` instance) and by __tests__/content-store.test.ts.
 */
import path from "node:path";

import type { ArtifactStorage } from "../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../artifactstorage/artifact-storage.js";

/**
 * Storage abstraction for content-addressed archives. The interface exists
 * for the same reason Go's did: the cloud edition uses R2 behind the
 * identical surface, and a controller must not know which one it holds.
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
 * A storage key that addresses nothing inside the store — missing file OR
 * a traversal-shaped key (both render as Go's "artifact not found: %s").
 */
export class ArtifactNotFoundError extends Error {
  constructor(storageKey: string) {
    super(`artifact not found: ${storageKey}`);
    this.name = "ArtifactNotFoundError";
  }
}

/** Archives are zip files; the driver stores the honest type. */
const ARCHIVE_CONTENT_TYPE = "application/zip";

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
  const virtualRoot = path.resolve(path.sep, "archive-store");
  const keyEscapesStore = (storageKey: string): boolean => {
    const resolved = path.resolve(virtualRoot, storageKey);
    return (
      resolved !== virtualRoot && !resolved.startsWith(virtualRoot + path.sep)
    );
  };

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
