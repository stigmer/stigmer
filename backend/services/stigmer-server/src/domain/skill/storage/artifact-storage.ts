/**
 * Skill artifact store — ports pkg/domain/skill/storage/artifact_storage.go.
 * Content-addressed, write-once, never garbage-collected (OD-5): artifacts
 * live at {storagePath}/skills/{sha256}.zip, byte-identical to Go's paths —
 * at cutover the TS server inherits a Go-written storage directory and must
 * serve its artifacts in place. There is deliberately NO delete method on
 * the interface: historical versions stay downloadable through the storage
 * keys listVersions exposes.
 *
 * Since O5 (20260827.02, blueprint 03 §6b) this is a DOMAIN PORT layered
 * over the one ArtifactStorage blob driver (the Q2 gate ruling): the
 * driver stores blobs; this module owns the keys, the write-once posture,
 * and the not-found vocabulary. The compose root hands it a PER-DOMAIN
 * driver instance rooted at storagePath (the Q2b ruling) — skill artifacts
 * never silently follow the generic artifact store's backend selection.
 *
 * Proven by __tests__/artifact-storage.test.ts and the skill conformance
 * suite's getArtifact/round-trip tests.
 */
import path from "node:path";

import type { ArtifactStorage } from "../../../artifactstorage/artifact-storage.js";
import { ArtifactStorageNotFoundError } from "../../../artifactstorage/artifact-storage.js";

/**
 * Storage abstraction for skill artifacts (Go ArtifactStorage). The
 * interface exists for the same reason as Go's: cloud uses R2 behind the
 * identical surface, and the controller must not know which one it holds.
 */
export interface SkillArtifactStorage {
  /** Saves an artifact under its content hash; returns the storage key. */
  store(hash: string, data: Uint8Array): Promise<string>;
  /** Loads an artifact by storage key; throws ArtifactNotFoundError if absent. */
  get(storageKey: string): Promise<Uint8Array>;
  /** Whether an artifact with this content hash already exists (dedupe). */
  exists(hash: string): Promise<boolean>;
  /** The storage key for a hash, without storing ("skills/<hash>.zip"). */
  getStorageKey(hash: string): string;
  /** The stored artifact's byte size via stat — never loads content. */
  size(storageKey: string): Promise<number>;
}

/**
 * A storage key that addresses nothing inside the store — missing file OR
 * a traversal-shaped key (both render as Go's "artifact not found: %s";
 * distinguishing them would tell a probing caller which escapes exist).
 */
export class ArtifactNotFoundError extends Error {
  constructor(storageKey: string) {
    super(`artifact not found: ${storageKey}`);
    this.name = "ArtifactNotFoundError";
  }
}

/** Skill artifacts are zip archives; the driver stores the honest type. */
const SKILL_ARTIFACT_CONTENT_TYPE = "application/zip";

/**
 * The skill store over a blob driver. Object-literal factory rather than a
 * class: all state is the captured driver, and the seam-adapter shape
 * matches runner-credential-provider.ts (the O5 house style for ports).
 */
export function newSkillArtifactStorage(
  driver: ArtifactStorage,
): SkillArtifactStorage {
  return {
    /**
     * "skills/<hash>.zip" — the relative key format shared with cloud R2.
     * Deliberately a LITERAL forward-slash join, not path.join: the key is
     * a wire-visible identifier (status.artifact_storage_key, download
     * URLs, the lane's "skills/" prefix check), and Windows support
     * arrives only through this server (#24) — path.join would mint
     * backslash keys there that the download lane could never serve.
     */
    getStorageKey(hash: string): string {
      return `skills/${hash}.zip`;
    },

    async store(hash: string, data: Uint8Array): Promise<string> {
      const storageKey = this.getStorageKey(hash);
      await driver.upload(storageKey, data, SKILL_ARTIFACT_CONTENT_TYPE);
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
 * The domain's own traversal guard (Go resolveWithinRoot, kept HERE per
 * "the domain owns keys"): a client-supplied storage key that resolves
 * outside the store addresses nothing inside it, and must collapse to the
 * same not-found as a missing file BEFORE the driver sees it — the
 * driver's own containment refusal is a distinguishable error, and
 * distinguishing them would tell a probing caller which escapes exist.
 * Lexical, against a fixed virtual root, so the judgment is identical on
 * every backend rather than an accident of the local driver's directory.
 */
function keyEscapesStore(storageKey: string): boolean {
  const virtualRoot = path.resolve(path.sep, "skill-store");
  const resolved = path.resolve(virtualRoot, storageKey);
  return (
    resolved !== virtualRoot && !resolved.startsWith(virtualRoot + path.sep)
  );
}
