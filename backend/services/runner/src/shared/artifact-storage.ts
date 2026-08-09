/**
 * Artifact storage abstraction for the unified runner.
 *
 * Two backends:
 * - Local: writes to the filesystem (OSS mode). The runner reads its own
 *   artifacts straight back off disk via {@link ArtifactStorage.download} — the
 *   exact inverse of {@link ArtifactStorage.upload}. `getDownloadUrl` still
 *   returns the stigmer-server serve URL, but that is for OTHER consumers (the
 *   web console fetching an artifact for display), not the runner's own reads.
 * - Proxy: uses presigned URLs from the Stigmer Side-Channel Proxy (cloud mode).
 *   Here `download` resolves a presigned URL and fetches it over HTTPS.
 *
 * The runner never holds R2/S3 credentials — in cloud mode it calls the proxy
 * to obtain a presigned upload URL, then PUTs content over plain HTTPS.
 *
 * DD-6: No direct R2 backend. Local + Proxy only.
 */

import { mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { homedir } from "node:os";
import type { Config } from "../config.js";

// ── Interface ────────────────────────────────────────────────────────

export interface ArtifactStorage {
  upload(key: string, content: Buffer, contentType?: string): Promise<string>;
  getDownloadUrl(key: string): Promise<string>;
  /**
   * Read an artifact's raw bytes by key — the inverse of {@link upload} and the
   * single read path for all runner read-back (CAS reconcile, exact-apply,
   * claimcheck decode, attachment injection).
   *
   * Returns the exact stored bytes, or throws a descriptive, key-scoped `Error`
   * when the object is missing or the transport fails. Per-backend semantics:
   * local reads directly off disk; proxy resolves a presigned URL and fetches
   * it. Callers own their own error-wrapping / degradation policy.
   */
  download(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export type ArtifactStorageType = "local" | "proxy";

// ── Local Backend ────────────────────────────────────────────────────

export class LocalArtifactStorage implements ArtifactStorage {
  private readonly basePath: string;
  private readonly serveUrlBase: string;

  constructor(basePath: string, serveUrlBase: string) {
    this.basePath = basePath;
    this.serveUrlBase = serveUrlBase.replace(/\/+$/, "");
  }

  async upload(key: string, content: Buffer, _contentType?: string): Promise<string> {
    const filePath = this.resolveWithinRoot(key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return key;
  }

  async getDownloadUrl(key: string): Promise<string> {
    return `${this.serveUrlBase}/${key}`;
  }

  async download(key: string): Promise<Buffer> {
    // Direct disk read — the exact inverse of `upload`. The runner wrote these
    // bytes to `basePath`, so it reads them back without a self-HTTP round-trip
    // and without depending on the serve URL being set or reachable.
    const filePath = this.resolveWithinRoot(key);
    try {
      return await readFile(filePath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // A miss here in local mode almost always means the runner and the
      // stigmer-server disagree on the artifact directory. Name the fix inline
      // so a stock-install operator does not have to reverse-engineer it (#285).
      throw new Error(
        `Artifact not found for key '${key}' under local artifact root '${this.basePath}': ${reason}. ` +
        `In local mode LOCAL_ARTIFACT_PATH must equal the stigmer-server's ARTIFACT_LOCAL_BASE_PATH ` +
        `(default '~/.stigmer/data/artifacts').`,
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const filePath = this.resolveWithinRoot(key);
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Map a storage key to an absolute path and guarantee it stays inside
   * `basePath`. Storage keys embed a caller-influenced attachment filename, and
   * `join` *cleans* `..` rather than rejecting it — so without this guard a
   * crafted key escapes the store and reads or writes arbitrary paths. Mirrors
   * the Go `LocalStorage` containment check so both implementations of the one
   * storage contract behave identically. Escapes throw; they never return a
   * usable path.
   */
  private resolveWithinRoot(key: string): string {
    const root = resolve(this.basePath);
    const full = resolve(this.basePath, key);
    if (full !== root && !full.startsWith(root + sep)) {
      throw new Error(
        `storage key '${key}' resolves outside the artifact storage root`,
      );
    }
    return full;
  }
}

// ── Proxy Backend ────────────────────────────────────────────────────

export class ProxyArtifactStorage implements ArtifactStorage {
  private readonly baseUrl: string;
  private readonly authTokenSource: ProxyAuthTokenSource;

  constructor(proxyEndpoint: string, authToken: ProxyAuthTokenSource) {
    this.baseUrl = `${proxyEndpoint.replace(/\/+$/, "")}/v1/proxy/artifacts`;
    this.authTokenSource = authToken;
  }

  /**
   * Resolve the credential per call rather than pinning the boot token: a
   * cloud sandbox's control-plane token rotates in place (see
   * sandbox-token-renewal.ts), and this storage lives for the pod's whole
   * life — a captured string would silently 401 after the first rotation.
   */
  private get authToken(): string {
    return typeof this.authTokenSource === "string"
      ? this.authTokenSource
      : (this.authTokenSource.current ?? "");
  }

  async upload(key: string, content: Buffer, contentType?: string): Promise<string> {
    const ct = contentType ?? "application/octet-stream";

    const presignResp = await fetch(`${this.baseUrl}/presigned-upload-url`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key, content_type: ct }),
    });
    if (!presignResp.ok) {
      throw new Error(
        `Failed to get presigned upload URL (HTTP ${presignResp.status}): ` +
        await presignResp.text(),
      );
    }

    const data = await presignResp.json() as { url: string; headers?: Record<string, string> };

    // Send exactly the headers the proxy signed. The presigner is the single
    // source of truth for what must be on the wire: a SigV4 presigned PUT signs
    // `content-type` (and `host`), so re-adding or duplicating any signed header
    // changes its value and the store rejects the upload with
    // `SignatureDoesNotMatch`. We therefore replay the signed set verbatim —
    // never appending our own `Content-Type` when the signer already covered it.
    // `host` is set by fetch from the URL and cannot be overridden, so drop it.
    const signedHeaders = data.headers ?? {};
    const uploadHeaders: Record<string, string> = {};
    let contentTypeSigned = false;
    for (const [name, value] of Object.entries(signedHeaders)) {
      if (name.toLowerCase() === "host") continue;
      if (name.toLowerCase() === "content-type") contentTypeSigned = true;
      uploadHeaders[name] = value;
    }
    // Only set Content-Type ourselves if the presigner did NOT sign it (so the
    // stored object still records the right type); when it IS signed, adding it
    // would corrupt the signed value.
    if (!contentTypeSigned) {
      uploadHeaders["Content-Type"] = ct;
    }

    const putResp = await fetch(data.url, {
      method: "PUT",
      headers: uploadHeaders,
      body: content,
    });
    if (!putResp.ok) {
      throw new Error(
        `Presigned upload failed (HTTP ${putResp.status}): ` +
        await putResp.text(),
      );
    }

    return key;
  }

  async getDownloadUrl(key: string): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/presigned-download-url`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ key }),
    });
    if (!resp.ok) {
      throw new Error(
        `Failed to get presigned download URL (HTTP ${resp.status}): ` +
        await resp.text(),
      );
    }
    const data = await resp.json() as { url: string };
    return data.url;
  }

  async download(key: string): Promise<Buffer> {
    const url = await this.getDownloadUrl(key);
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(
        `Artifact download failed (HTTP ${resp.status}) for key '${key}': ` +
        await resp.text(),
      );
    }
    return Buffer.from(await resp.arrayBuffer());
  }

  async exists(key: string): Promise<boolean> {
    // A presigned URL is minted for ANY key — the presign endpoint does not check
    // the object — so "did presign succeed?" is NOT existence (that bug turned a
    // git-only file-review reconcile into a doomed manifest download + 404 crash).
    // Probe the object itself with a 1-byte ranged GET: the presigned URL is
    // SigV4-signed for GET (a HEAD would break the signature), and `Range:
    // bytes=0-0` transfers at most one byte. Missing => 404; present => 200/206
    // (or 416 for a 0-byte object, whose range is unsatisfiable yet it exists).
    let url: string;
    try {
      url = await this.getDownloadUrl(key);
    } catch {
      // Presign endpoint unreachable: report absent. The sole caller (content-
      // addressed CAS blob dedup) then re-uploads, which is idempotent.
      return false;
    }
    const resp = await fetch(url, { headers: { Range: "bytes=0-0" } });
    await resp.arrayBuffer().catch(() => undefined); // drain the <=1-byte body
    if (resp.status === 404) return false;
    if (resp.status === 200 || resp.status === 206 || resp.status === 416) return true;
    // Any other status (e.g. 403 expired/misconfigured, 5xx) is a real fault, not
    // an existence answer — surface it rather than silently mis-reporting.
    throw new Error(
      `Artifact existence check failed (HTTP ${resp.status}) for key '${key}'`,
    );
  }
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * The proxy credential, either fixed (a caller-supplied string) or live (a
 * shared mutable ref, read per call — the sandbox token-renewal posture).
 */
export type ProxyAuthTokenSource = string | { readonly current: string | null };

export interface ArtifactStorageConfig {
  readonly type: ArtifactStorageType;
  readonly localPath: string;
  readonly localServeUrl: string;
  readonly proxyEndpoint: string | null;
  readonly proxyAuthToken: ProxyAuthTokenSource | null;
}

/**
 * The default local artifact root, `~/.stigmer/data/artifacts`. This must be
 * the SAME directory the stigmer-server writes to (its ARTIFACT_LOCAL_BASE_PATH
 * default) so a storage-key artifact the server wrote resolves when the runner
 * reads it back (#285). The old default (`/var/stigmer/artifacts`) pointed at an
 * unrelated, non-writable tree on a stock host, silently disabling the store.
 * Mirrors the Go server's defensive fallback when the home dir is unresolved.
 */
function defaultLocalArtifactPath(): string {
  const home = homedir();
  return home
    ? join(home, ".stigmer", "data", "artifacts")
    : join(".", "artifacts");
}

export function loadArtifactStorageConfig(config: Config): ArtifactStorageConfig {
  // Storage follows transport, not execution location: if a proxy endpoint is
  // configured, push artifacts through it (the proxy brokers R2). This holds for
  // both cloud runners and the local desktop runner — the latter executes
  // locally (mode === "local") yet still uploads via the proxy. An explicit
  // ARTIFACT_STORAGE_TYPE always wins.
  const envType = process.env.ARTIFACT_STORAGE_TYPE;
  const type: ArtifactStorageType =
    envType === "proxy" ? "proxy" :
    envType === "local" ? "local" :
    config.proxyEndpoint ? "proxy" : "local";

  return {
    type,
    localPath: process.env.LOCAL_ARTIFACT_PATH ?? defaultLocalArtifactPath(),
    localServeUrl: process.env.LOCAL_ARTIFACT_SERVE_URL ?? "http://localhost:7235",
    proxyEndpoint: type === "proxy" ? (config.proxyEndpoint ?? null) : null,
    // Prefer the live ref: renewal rotates the token in place and uploads
    // must present the current credential, not the boot one.
    proxyAuthToken: type === "proxy"
      ? (config.stigmerTokenRef ?? config.stigmerToken ?? null)
      : null,
  };
}

export function createArtifactStorage(cfg: ArtifactStorageConfig): ArtifactStorage {
  if (cfg.type === "proxy") {
    if (!cfg.proxyEndpoint) {
      throw new Error("Proxy artifact storage requires STIGMER_PROXY_ENDPOINT");
    }
    const tokenAtBoot = typeof cfg.proxyAuthToken === "string"
      ? cfg.proxyAuthToken
      : cfg.proxyAuthToken?.current;
    if (!tokenAtBoot) {
      throw new Error("Proxy artifact storage requires STIGMER_TOKEN");
    }
    return new ProxyArtifactStorage(cfg.proxyEndpoint, cfg.proxyAuthToken!);
  }

  return new LocalArtifactStorage(cfg.localPath, cfg.localServeUrl);
}

/**
 * Prove that `basePath` can actually be written to, the way {@link
 * LocalArtifactStorage.upload} writes: create the directory tree, write a
 * throwaway file, then remove it. Returns `false` on any failure.
 *
 * We do an actual write rather than `access(basePath, W_OK)` deliberately:
 * `access` can lie under root / ACLs / overlay filesystems (it checks the
 * permission bits, not the real outcome), it does not exercise the recursive
 * `mkdir` + `writeFile` that `upload` performs (so it misses a `basePath` whose
 * parent is a file, an ENOTDIR), and it cannot catch a full disk. The scratch
 * file is uniquely named so concurrent runners never collide, and is removed
 * even though `basePath` (which we want to exist anyway) is left in place.
 */
async function isLocalPathWritable(basePath: string): Promise<boolean> {
  const probePath = join(basePath, `.write-probe-${process.pid}-${Date.now()}`);
  try {
    await mkdir(basePath, { recursive: true });
    await writeFile(probePath, "");
    await rm(probePath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a *usable* artifact store for the file-review capture / status-offload
 * path, degrading to `undefined` instead of crashing when there is no working
 * substrate. This is the single construct-or-degrade seam shared by both
 * harnesses (the deep-agent and Cursor activities) so they degrade identically.
 *
 * Two degrade paths:
 *  - **Proxy misconfig** — {@link createArtifactStorage} throws for a missing
 *    endpoint/token; caught here and reported absent.
 *  - **Unwritable local path** — {@link LocalArtifactStorage} constructs around a
 *    path string and never throws, so an unwritable base path (bad mount, EPERM,
 *    full disk) would otherwise let file writes FLOW during the turn and only
 *    crash at the turn-boundary upload, with the workspace already mutated and no
 *    review authored. We probe writability up front and report absent instead.
 *
 * Proxy is intentionally NOT probed at the network layer: a live-endpoint check
 * would add a round-trip to every cloud setup and risk falsely degrading on a
 * transient blip; construction already validates its config.
 *
 * An absent store is a first-class, already-supported state (DD-26): capture
 * degrades to the deny-gate (via {@link deriveCaptureMode}'s `hasArtifactStorage`
 * argument), tool-output offload is disabled (the aggregate size guard still
 * applies), and attachment / plan-artifact publishing surface a clear error.
 * This is the fail-safe realization of DD-26 follow-up #1.
 *
 * NOTE: this resolver is for the capture/offload path only. Claimcheck (Temporal
 * payload offload) MUST have storage and has no deny-gate to fall back to, so it
 * deliberately keeps calling {@link createArtifactStorage} directly (fail-hard).
 */
export async function resolveUsableArtifactStorage(
  cfg: ArtifactStorageConfig,
  ctx: { executionId: string },
): Promise<ArtifactStorage | undefined> {
  let storage: ArtifactStorage;
  try {
    storage = createArtifactStorage(cfg);
  } catch (err) {
    console.warn(
      `[artifact-storage] unavailable — file capture degrades to the deny-gate ` +
      `and tool-output offload is disabled: execution=${ctx.executionId}, ` +
      `type=${cfg.type}, error=${err}`,
    );
    return undefined;
  }

  if (cfg.type === "local" && !(await isLocalPathWritable(cfg.localPath))) {
    console.warn(
      `[artifact-storage] local path not writable — file capture degrades to the ` +
      `deny-gate, tool-output offload is disabled, and storage-backed attachments ` +
      `will fail: execution=${ctx.executionId}, path=${cfg.localPath}. ` +
      `Set LOCAL_ARTIFACT_PATH to a writable directory that equals the stigmer-server's ` +
      `ARTIFACT_LOCAL_BASE_PATH (default '~/.stigmer/data/artifacts').`,
    );
    return undefined;
  }

  return storage;
}
