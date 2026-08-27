/**
 * Artifact storage — ports pkg/domain/artifact/storage/{storage.go,
 * local_storage.go,disposition.go}: the execution-output/attachment blob
 * store SHARED (D1) by agentexecution attachments (#17), the artifact
 * domain + its port+1 file server (#13), and skill's
 * pushFromExecutionArtifact (#8). Cross-cutting home, like
 * src/encryption/ (the ratified sub-project DD).
 *
 * The LOCAL backend is the OSS default: the configured base path IS the
 * artifact root — a key K stores at <basePath>/<K> with no implicit
 * segment, so the server and the runner (LOCAL_ARTIFACT_PATH) share one
 * store by construction (#285).
 *
 * The R2 backend (S3-compatible, AWS SDK) lives in r2-storage.ts — it
 * arrived with the artifact domain (#13) per the ratified deferral, closing
 * the temporary ARTIFACT_STORAGE_TYPE=r2 boot-fail divergence #17 shipped.
 *
 * Since O5 (20260827.02, blueprint 03 §6b) this is the ONE blob-driver
 * seam of the convergence program: it gained the presigned-PUT capability,
 * `size`, a typed not-found error, and registry-driven driver registration
 * (extensions/drivers.ts). Domain semantics — content-addressed keys,
 * staging lanes, write-once postures — deliberately live ABOVE this
 * interface in their owning domains: the driver stores blobs; the domain
 * owns keys and lanes.
 */
import { mkdirSync } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { goQueryEscape } from "../gocompat/query-escape.js";
import { R2ArtifactStorage } from "./r2-storage.js";

/** Query key carrying the desired download filename on local URLs; the
 * artifact file server (#13) reads it to set Content-Disposition. */
export const LOCAL_DOWNLOAD_QUERY_PARAM = "download";

/**
 * A storage key that addresses no stored blob. Consumers that must map
 * "missing" onto their own domain vocabulary (skill's ArtifactNotFoundError,
 * a NotFound wire code) branch on this class per the ratified store-fault
 * instanceof idiom; every OTHER driver failure is an infrastructure fault
 * to rethrow or wrap, never a not-found.
 */
export class ArtifactStorageNotFoundError extends Error {
  constructor(key: string) {
    // The local backend's historical copy, kept verbatim — this class adds
    // a type to the existing message, not a new message.
    super(`artifact not found: ${key}`);
    this.name = "ArtifactStorageNotFoundError";
  }
}

/**
 * A staged upload minted by presignPut: the URL receives the bytes, the
 * stagingKey reads them back through the same driver. Staged blobs are
 * short-lived by contract — the local lane sweeps them on TTL expiry and
 * boot; R2 deployments configure a bucket lifecycle rule on the staging
 * prefix (the §6b driver-side sweep expectation).
 */
export interface PresignedUpload {
  /** Accepts one HTTP PUT of exactly the declared byte count. */
  readonly url: string;
  /** Driver key where the staged bytes land, readable via download(). */
  readonly stagingKey: string;
  /** The TTL actually granted, after per-driver clamping. */
  readonly ttlMs: number;
}

export interface ArtifactStorage {
  /** Stores artifact data under the key. */
  upload(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /**
   * Retrieves artifact data by key; a key addressing no stored blob
   * throws ArtifactStorageNotFoundError.
   */
  download(key: string): Promise<Uint8Array>;
  /**
   * The stored blob's byte size without loading its content (local stat /
   * R2 HeadObject); a key addressing no stored blob throws
   * ArtifactStorageNotFoundError.
   */
  size(key: string): Promise<number>;
  /**
   * A time-limited download URL. downloadFilename, when non-empty, bakes
   * a browser-download disposition into the URL (browsers ignore the HTML
   * `download` attribute cross-origin); empty serves inline.
   */
  getSignedUrl(
    key: string,
    expiresInMs: number,
    downloadFilename: string,
  ): Promise<string>;
  /**
   * A time-limited upload URL for a staging-prefixed blob of exactly
   * declaredSizeBytes (§6b). Per-driver semantics differ DELIBERATELY and
   * are contract, not accident: the local backend rides the skill transfer
   * lane's URL-as-credential slot mechanism (single-use, exact-size
   * enforced by the lane, TTL clamped to the lane's slot TTL) and answers
   * only on instances with a staged-upload lane wired — unwired instances
   * throw the explicit not-configured error, never a silent no-op. The R2
   * backend presigns a PUT (repeatable within its TTL, size enforced by
   * the signed Content-Length header, TTL clamped to the 7-day R2
   * maximum).
   */
  presignPut(declaredSizeBytes: number, ttlMs: number): Promise<PresignedUpload>;
  /** Removes the artifact; missing is not an error. */
  delete(key: string): Promise<void>;
  /** Whether an artifact with the key exists. */
  exists(key: string): Promise<boolean>;
  /** Storage connectivity/writability probe (boot health check). */
  health(): Promise<void>;
}

/**
 * Constructs a registered driver. Lazy DELIBERATELY (the WorkerFactory
 * precedent): driver constructors may have side effects — the local
 * backend mkdirs its root — and a composition must not pay them for
 * drivers its config never selects. Extensions close over their own
 * configuration; the factory takes nothing.
 */
export type ArtifactStorageDriverFactory = () => ArtifactStorage;

/**
 * The staged-upload mechanism a LocalArtifactStorage instance rides for
 * presignPut — the seam the composition root adapts the skill transfer
 * lane's UploadSlots + URL renderer into (Q1 ruling, 20260827.02 T01: one
 * upload surface, no new lane). Declared HERE, not imported from the skill
 * domain: the §6b layering runs domain-over-driver, so the driver states
 * the shape it needs and stays ignorant of who provides it.
 */
export interface StagedUploadLane {
  /** Reserves a single-use upload slot; returns its reference + TTL. */
  mint(declaredSizeBytes: number): { ref: string; ttlMs: number };
  /** The externally-reachable PUT URL for a minted reference. */
  uploadUrl(ref: string): string;
  /**
   * The driver key where the reference's staged bytes land — MUST resolve
   * inside the driver instance's root, or download(stagingKey) could
   * never read what the lane received.
   */
  stagedKey(ref: string): string;
}

export interface ArtifactStorageConfig {
  /** "local" or "r2" ("" defaults to local — Go NewArtifactStorage). */
  readonly type: string;
  readonly localBasePath: string;
  readonly localServeUrl: string;
  /** Cloudflare R2 (S3-compatible) settings — required when type is "r2". */
  readonly r2Bucket: string;
  readonly r2Endpoint: string;
  readonly r2AccessKeyId: string;
  readonly r2SecretAccessKey: string;
  readonly r2Region: string;
}

/**
 * The built-in driver names. Registered drivers may not shadow them —
 * resolveExtensions enforces that at boot (a shadowed built-in would be
 * silently unreachable, the §2b loud-fail rules forbid exactly that).
 */
export const BUILT_IN_STORAGE_TYPES = ["local", "r2"] as const;

/**
 * Factory mirroring Go NewArtifactStorage, opened to registered drivers
 * with O5 (§6b): built-ins first, then the composition's registered driver
 * map — the cloud substitutes its per-domain R2 drivers without this
 * switch ever growing a case.
 */
export function newArtifactStorage(
  config: ArtifactStorageConfig,
  registeredDrivers: ReadonlyMap<string, ArtifactStorageDriverFactory> = new Map(),
): ArtifactStorage {
  const storageType = config.type === "" ? "local" : config.type;
  switch (storageType) {
    case "local":
      return new LocalArtifactStorage(
        config.localBasePath,
        config.localServeUrl,
      );
    case "r2":
      return new R2ArtifactStorage({
        bucket: config.r2Bucket,
        endpoint: config.r2Endpoint,
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
        region: config.r2Region,
      });
    default: {
      const registered = registeredDrivers.get(storageType);
      if (registered !== undefined) {
        return registered();
      }
      const known = [...BUILT_IN_STORAGE_TYPES, ...registeredDrivers.keys()]
        .map((name) => `'${name}'`)
        .join(" or ");
      throw new Error(`unknown storage type: ${storageType} (must be ${known})`);
    }
  }
}

export class LocalArtifactStorage implements ArtifactStorage {
  constructor(
    private readonly basePath: string,
    private readonly serveUrl: string,
    /**
     * The staged-upload mechanism backing presignPut — optional because
     * only instances whose root the lane stages into can serve it (the
     * skill store instance today); presignPut on an unwired instance is
     * the explicit not-configured throw, mirroring getSignedUrl's
     * serve-URL posture.
     */
    private readonly stagedUploadLane?: StagedUploadLane,
  ) {
    // Ensure the artifact root exists (Go NewLocalStorage MkdirAll).
    mkdirSync(this.root(), { recursive: true });
  }

  async upload(
    key: string,
    data: Uint8Array,
    _contentType: string,
  ): Promise<void> {
    const filePath = this.resolveWithinRoot(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    // Restricted permissions, matching Go's 0600.
    await writeFile(filePath, data, { mode: 0o600 });
  }

  async download(key: string): Promise<Uint8Array> {
    const filePath = this.resolveWithinRoot(key);
    try {
      return await readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ArtifactStorageNotFoundError(key);
      }
      throw error;
    }
  }

  async size(key: string): Promise<number> {
    const filePath = this.resolveWithinRoot(key);
    try {
      return (await stat(filePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new ArtifactStorageNotFoundError(key);
      }
      throw error;
    }
  }

  async presignPut(
    declaredSizeBytes: number,
    _ttlMs: number,
  ): Promise<PresignedUpload> {
    if (this.stagedUploadLane === undefined) {
      throw new Error(
        "local presigned uploads not configured - no staged-upload lane is wired to this store instance",
      );
    }
    // The lane's slot TTL governs, not the caller's ask — the slot
    // registry sweeps on ITS clock, and a URL outliving its slot would be
    // a credential for nothing.
    const { ref, ttlMs } = this.stagedUploadLane.mint(declaredSizeBytes);
    return {
      url: this.stagedUploadLane.uploadUrl(ref),
      stagingKey: this.stagedUploadLane.stagedKey(ref),
      ttlMs,
    };
  }

  async getSignedUrl(
    key: string,
    _expiresInMs: number,
    downloadFilename: string,
  ): Promise<string> {
    if (this.serveUrl === "") {
      throw new Error("local serve URL not configured");
    }
    let url = `${this.serveUrl}/${key}`;
    if (downloadFilename !== "") {
      url += `?${LOCAL_DOWNLOAD_QUERY_PARAM}=${goQueryEscape(downloadFilename)}`;
    }
    return url;
  }

  async delete(key: string): Promise<void> {
    const filePath = this.resolveWithinRoot(key);
    await rm(filePath, { force: true });
    await this.cleanupEmptyDirs(path.dirname(filePath));
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolveWithinRoot(key);
    try {
      await stat(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw error;
    }
  }

  async health(): Promise<void> {
    const info = await stat(this.root()).catch((error: unknown) => {
      throw new Error(
        `artifacts directory not accessible: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (!info.isDirectory()) {
      throw new Error("artifacts path is not a directory");
    }
    const testFile = path.join(this.root(), ".health_check");
    await writeFile(testFile, "ok", { mode: 0o600 }).catch(
      (error: unknown) => {
        throw new Error(
          `artifacts directory not writable: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
    await rm(testFile, { force: true });
  }

  /**
   * The single directory every key resolves under — the base path itself
   * (#285): the key→path mapping, the health probe, and the cleanup floor
   * can never disagree about where the store lives.
   */
  private root(): string {
    return this.basePath;
  }

  /**
   * Maps a storage key to an absolute path, guaranteeing the result stays
   * inside the artifact root. Keys carry caller-influenced segments (an
   * attachment's original filename rides in the key) and path.join CLEANS
   * `..` rather than rejecting it — without this guard a crafted key
   * escapes the store. A key resolving outside the root is refused with a
   * descriptive, non-path error.
   */
  private resolveWithinRoot(key: string): string {
    const root = this.root();
    const full = path.join(root, key);
    if (!isWithin(root, full)) {
      throw new Error(
        `storage key ${JSON.stringify(key)} resolves outside the artifact storage root`,
      );
    }
    return full;
  }

  /**
   * Removes empty parent directories up to (but never including) the
   * artifact root; stops at the first non-empty directory.
   */
  private async cleanupEmptyDirs(dir: string): Promise<void> {
    const root = this.root();
    if (!isWithin(root, dir) || path.resolve(dir) === path.resolve(root)) {
      return;
    }
    try {
      // rmdir fails on non-empty directories — exactly the stop signal
      // (Go os.Remove semantics).
      await rmdir(dir);
    } catch {
      return;
    }
    await this.cleanupEmptyDirs(path.dirname(dir));
  }
}

// goQueryEscape moved to src/gocompat/query-escape.ts when the github
// broker became its second consumer (#13) — the shared-steps promotion
// rule. Behavior unchanged; the URL parity tests below still pin it.

/**
 * Whether `p` is `root` itself or a descendant — cleaned-path comparison
 * with a trailing separator so a sibling sharing a name prefix (`/a/bc`
 * vs `/a/b`) is correctly excluded (Go isWithin).
 */
function isWithin(root: string, p: string): boolean {
  const cleanRoot = path.resolve(root);
  const cleanPath = path.resolve(p);
  return (
    cleanPath === cleanRoot || cleanPath.startsWith(cleanRoot + path.sep)
  );
}

/**
 * Content-Disposition header value instructing a browser to save the
 * response as a download named filename (Go
 * ContentDispositionAttachment): a plain quoted `filename="..."`
 * (ASCII-sanitized fallback) plus, when the name carries non-ASCII, the
 * RFC 5987 `filename*=UTF-8''...` parameter modern browsers prefer. The
 * fallback escapes embedded quotes and backslashes, so a crafted name can
 * never break out of the header value. Consumed by #13's file server;
 * defined with the storage it describes.
 */
export function contentDispositionAttachment(filename: string): string {
  const ascii = sanitizeAsciiFilename(filename);
  const quoted = `"${ascii.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
  let disposition = `attachment; filename=${quoted}`;
  if (ascii !== filename) {
    disposition += `; filename*=UTF-8''${rfc5987Encode(filename)}`;
  }
  return disposition;
}

/** Bytes outside printable ASCII (and controls) become '_' (Go twin). */
function sanitizeAsciiFilename(filename: string): string {
  let out = "";
  for (const r of filename) {
    const code = r.codePointAt(0) ?? 0;
    out += code < 0x20 || code > 0x7e ? "_" : r;
  }
  return out;
}

/** Percent-encodes per RFC 5987 ext-value, attr-chars unescaped. */
function rfc5987Encode(filename: string): string {
  const bytes = Buffer.from(filename, "utf-8");
  let out = "";
  for (const c of bytes) {
    if (isRfc5987AttrChar(c)) {
      out += String.fromCharCode(c);
    } else {
      out += `%${c.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

function isRfc5987AttrChar(c: number): boolean {
  if (
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x30 && c <= 0x39) // 0-9
  ) {
    return true;
  }
  return "!#$&+-.^_`|~".includes(String.fromCharCode(c));
}
