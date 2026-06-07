/**
 * Artifact storage abstraction for the unified runner.
 *
 * Two backends:
 * - Local: writes to the filesystem, served by stigmer-server (OSS mode).
 * - Proxy: uses presigned URLs from the Stigmer Side-Channel Proxy (cloud mode).
 *
 * The runner never holds R2/S3 credentials — in cloud mode it calls the proxy
 * to obtain a presigned upload URL, then PUTs content over plain HTTPS.
 *
 * DD-6: No direct R2 backend. Local + Proxy only.
 */

import { mkdir, writeFile, readFile, access, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Config } from "../config.js";

// ── Interface ────────────────────────────────────────────────────────

export interface ArtifactStorage {
  upload(key: string, content: Buffer, contentType?: string): Promise<string>;
  getDownloadUrl(key: string): Promise<string>;
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
    const filePath = join(this.basePath, key);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    return key;
  }

  async getDownloadUrl(key: string): Promise<string> {
    return `${this.serveUrlBase}/${key}`;
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(join(this.basePath, key));
      return true;
    } catch {
      return false;
    }
  }
}

// ── Proxy Backend ────────────────────────────────────────────────────

export class ProxyArtifactStorage implements ArtifactStorage {
  private readonly baseUrl: string;
  private readonly authToken: string;

  constructor(proxyEndpoint: string, authToken: string) {
    this.baseUrl = `${proxyEndpoint.replace(/\/+$/, "")}/v1/proxy/artifacts`;
    this.authToken = authToken;
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
    const uploadHeaders: Record<string, string> = {
      ...data.headers,
      "Content-Type": ct,
    };

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

  async exists(key: string): Promise<boolean> {
    try {
      const resp = await fetch(`${this.baseUrl}/presigned-download-url`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.authToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export interface ArtifactStorageConfig {
  readonly type: ArtifactStorageType;
  readonly localPath: string;
  readonly localServeUrl: string;
  readonly proxyEndpoint: string | null;
  readonly proxyAuthToken: string | null;
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
    localPath: process.env.LOCAL_ARTIFACT_PATH ?? "/var/stigmer/artifacts",
    localServeUrl: process.env.LOCAL_ARTIFACT_SERVE_URL ?? "http://localhost:7235",
    proxyEndpoint: type === "proxy" ? (config.proxyEndpoint ?? null) : null,
    proxyAuthToken: type === "proxy" ? (config.stigmerToken ?? null) : null,
  };
}

export function createArtifactStorage(cfg: ArtifactStorageConfig): ArtifactStorage {
  if (cfg.type === "proxy") {
    if (!cfg.proxyEndpoint) {
      throw new Error("Proxy artifact storage requires STIGMER_PROXY_ENDPOINT");
    }
    if (!cfg.proxyAuthToken) {
      throw new Error("Proxy artifact storage requires STIGMER_TOKEN");
    }
    return new ProxyArtifactStorage(cfg.proxyEndpoint, cfg.proxyAuthToken);
  }

  return new LocalArtifactStorage(cfg.localPath, cfg.localServeUrl);
}
