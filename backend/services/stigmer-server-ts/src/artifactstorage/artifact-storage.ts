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
 * The R2 backend (S3-compatible, AWS SDK) is DEFERRED to #13 per the
 * owner-ratified plan decision: it would drag the AWS SDK into this
 * package's dependency surface and its presigned-URL semantics are
 * asserted on #13's RPC surface. Until then ARTIFACT_STORAGE_TYPE=r2
 * boot-fails with an explicit message — a disclosed, temporary
 * coexistence divergence (the Go server serves r2 today).
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

/** Query key carrying the desired download filename on local URLs; the
 * artifact file server (#13) reads it to set Content-Disposition. */
export const LOCAL_DOWNLOAD_QUERY_PARAM = "download";

export interface ArtifactStorage {
  /** Stores artifact data under the key. */
  upload(key: string, data: Uint8Array, contentType: string): Promise<void>;
  /** Retrieves artifact data by key. */
  download(key: string): Promise<Uint8Array>;
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
  /** Removes the artifact; missing is not an error. */
  delete(key: string): Promise<void>;
  /** Whether an artifact with the key exists. */
  exists(key: string): Promise<boolean>;
  /** Storage connectivity/writability probe (boot health check). */
  health(): Promise<void>;
}

export interface ArtifactStorageConfig {
  /** "local" or "r2" ("" defaults to local — Go NewArtifactStorage). */
  readonly type: string;
  readonly localBasePath: string;
  readonly localServeUrl: string;
}

/** Factory mirroring Go NewArtifactStorage; r2 is the deferred arm. */
export function newArtifactStorage(
  config: ArtifactStorageConfig,
): ArtifactStorage {
  const storageType = config.type === "" ? "local" : config.type;
  switch (storageType) {
    case "local":
      return new LocalArtifactStorage(
        config.localBasePath,
        config.localServeUrl,
      );
    case "r2":
      // Deferred to #13 (owner-ratified): fail loud at boot rather than
      // serving a silently different artifact store than configured.
      throw new Error(
        "ARTIFACT_STORAGE_TYPE=r2 is not yet supported by the TS server; " +
          "the R2 backend arrives with the artifact domain sub-project (D4 #13). " +
          "Use the Go server for r2-backed deployments during coexistence.",
      );
    default:
      throw new Error(
        `unknown storage type: ${storageType} (must be 'local' or 'r2')`,
      );
  }
}

export class LocalArtifactStorage implements ArtifactStorage {
  constructor(
    private readonly basePath: string,
    private readonly serveUrl: string,
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
        throw new Error(`artifact not found: ${key}`);
      }
      throw error;
    }
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
      // URLSearchParams matches Go url.Values.Encode (space → '+').
      const query = new URLSearchParams({
        [LOCAL_DOWNLOAD_QUERY_PARAM]: downloadFilename,
      });
      url += `?${query.toString()}`;
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
