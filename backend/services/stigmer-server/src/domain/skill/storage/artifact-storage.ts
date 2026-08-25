/**
 * Skill artifact store — ports pkg/domain/skill/storage/artifact_storage.go.
 * Content-addressed, write-once, never garbage-collected (OD-5): artifacts
 * live at {storagePath}/skills/{sha256}.zip, byte-identical to Go's paths —
 * at cutover the TS server inherits a Go-written storage directory and must
 * serve its artifacts in place. There is deliberately NO delete method on
 * the interface: historical versions stay downloadable through the storage
 * keys listVersions exposes.
 *
 * Proven by __tests__/artifact-storage.test.ts and the skill conformance
 * suite's getArtifact/round-trip tests.
 */
import fs from "node:fs";
import path from "node:path";

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

/** Filesystem implementation (Go LocalFileStorage). */
export class LocalFileStorage implements SkillArtifactStorage {
  private readonly storagePath: string;

  /** Creates the backend and ensures {storagePath}/skills exists (0755). */
  constructor(storagePath: string) {
    this.storagePath = storagePath;
    fs.mkdirSync(path.join(storagePath, "skills"), {
      recursive: true,
      mode: 0o755,
    });
  }

  /** Writes with 0600 (owner-only) — artifacts are not world-readable. */
  async store(hash: string, data: Uint8Array): Promise<string> {
    const storageKey = this.getStorageKey(hash);
    const filePath = path.join(this.storagePath, storageKey);
    await fs.promises.mkdir(path.dirname(filePath), {
      recursive: true,
      mode: 0o755,
    });
    await fs.promises.writeFile(filePath, data, { mode: 0o600 });
    return storageKey;
  }

  async get(storageKey: string): Promise<Uint8Array> {
    const filePath = this.resolveWithinRoot(storageKey);
    if (filePath === undefined) {
      throw new ArtifactNotFoundError(storageKey);
    }
    try {
      return await fs.promises.readFile(filePath);
    } catch (error) {
      if (isNotFound(error)) {
        throw new ArtifactNotFoundError(storageKey);
      }
      throw new Error(
        `failed to read artifact: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async exists(hash: string): Promise<boolean> {
    const filePath = path.join(this.storagePath, this.getStorageKey(hash));
    try {
      await fs.promises.stat(filePath);
      return true;
    } catch (error) {
      if (isNotFound(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * "skills/<hash>.zip" — the relative key format shared with cloud R2.
   * Deliberately a LITERAL forward-slash join, not path.join: the key is
   * a wire-visible identifier (status.artifact_storage_key, download
   * URLs, the lane's "skills/" prefix check), and Windows support arrives
   * only through this server (#24) — path.join would mint backslash keys
   * there that the download lane could never serve. Filesystem access
   * re-joins the key per-OS (store/get/size).
   */
  getStorageKey(hash: string): string {
    return `skills/${hash}.zip`;
  }

  async size(storageKey: string): Promise<number> {
    const filePath = this.resolveWithinRoot(storageKey);
    if (filePath === undefined) {
      throw new ArtifactNotFoundError(storageKey);
    }
    try {
      const info = await fs.promises.stat(filePath);
      return info.size;
    } catch (error) {
      if (isNotFound(error)) {
        throw new ArtifactNotFoundError(storageKey);
      }
      throw new Error(
        `failed to stat artifact: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Joins a client-supplied storage key to the root and confirms the
   * resolved path stays inside it (Go resolveWithinRoot) — traversal keys
   * ("../../etc/passwd") address nothing inside the store.
   */
  private resolveWithinRoot(storageKey: string): string | undefined {
    const root = path.resolve(this.storagePath);
    const filePath = path.resolve(root, storageKey);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      return undefined;
    }
    return filePath;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
