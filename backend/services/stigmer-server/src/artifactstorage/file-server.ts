/**
 * The local download lane: an HTTP listener that serves the bytes local
 * artifact storage (artifact-storage.ts) holds, at the URLs its
 * getSignedUrl mints. Two kinds of file reach a caller through it: an agent
 * run's files (run.getArtifactDownloadUrl) and the skill and plugin
 * archives a runner mounts (the staging driver's download links). The lane
 * is a second listener on 127.0.0.1:ARTIFACT_HTTP_PORT (unset: the unified
 * port + 1, ephemeral beside an ephemeral unified port — the rule is
 * boot/artifact-lane.ts), started only when artifact storage is LOCAL,
 * serving GET /<key> as the exact bytes LocalArtifactStorage wrote, to a
 * link that local backend signed: an expired, tampered or unsigned link is
 * answered the 404 a missing key gets, before the disk is touched, so a
 * refusal says nothing about what exists (artifactstorage/url-signer.ts).
 * Past the signature, a missing file is 404 and one that cannot be read (a
 * permission refused, a disk error) a 500 with a static body and the cause
 * in the server log, so a broken artifact never reads as a gone one
 * (stigmer#1352; __tests__/file-server-faults.test.ts). A bind failure
 * fails the boot: the composition binds the lane before SERVING and lets
 * listen()'s rejection stand (stigmer#1089). It is not a unified-port lane:
 * it is its own listener.
 *
 * Disposition contract (proven by __tests__/file-server.test.ts and, on
 * links the storage mints, __tests__/file-server-signing.test.ts): a
 * request carrying ?download=<name> (set by getSignedUrl) is served as a
 * browser download named by that parameter — mirroring the R2 backend,
 * which signs Content-Disposition into the presigned URL. Requests without
 * the parameter are served INLINE with no disposition header.
 *
 * Two deliberate omissions (neither pinned by a test):
 *   - No Content-Type header: the server does not sniff one; an absent
 *     header lets clients apply content sniffing themselves.
 *   - No Range support: range requests are answered with the full body
 *     (200), which HTTP permits.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { contentDispositionAttachment, LOCAL_DOWNLOAD_QUERY_PARAM } from "./artifact-storage.js";
import type { DownloadUrlSigner } from "./url-signer.js";
import type { Logger } from "../boot/logger.js";

export interface ArtifactFileServerOptions {
  /** The artifact root — the base path IS the root (#285). */
  readonly basePath: string;
  /** The signer the local backend mints links with; every request is verified by it. */
  readonly signer: DownloadUrlSigner;
  readonly logger: Logger;
}

export interface ArtifactFileServer {
  /**
   * Binds <host>:<port> (port 0 picks ephemeral) and resolves the port it
   * bound; a bind failure rejects, and the composition fails the boot on it.
   * The host is the composition root's call: 127.0.0.1 everywhere by
   * default (ARTIFACT_HTTP_HOST) — download URLs are minted for
   * the local machine — and 0.0.0.0 only inside the official container
   * image, where the loopback bind would strand the lane behind the
   * container boundary.
   */
  listen(port: number, host: string): Promise<number>;
  shutdown(): Promise<void>;
}

export function createArtifactFileServer(
  options: ArtifactFileServerOptions,
): ArtifactFileServer {
  const { basePath, signer, logger } = options;

  const server = http.createServer((req, res) => {
    void serveArtifact(basePath, signer, req, res, logger);
  });

  return {
    listen(port: number, host: string): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        // Loopback by DEFAULT: download URLs are minted for the local
        // machine, never a network interface. The host is configurable
        // (ARTIFACT_HTTP_HOST) for containers, where 127.0.0.1 is
        // unreachable from outside.
        server.listen(port, host, () => {
          server.removeListener("error", reject);
          const address = server.address();
          const boundPort =
            address !== null && typeof address === "object" ? address.port : port;
          logger.info("artifact HTTP file server listening", {
            port: boundPort,
            dir: basePath,
          });
          resolve(boundPort);
        });
      });
    },
    shutdown(): Promise<void> {
      return new Promise((resolve) => {
        server.close(() => resolve());
        // In-flight downloads do not hold shutdown open: close() stops the
        // listener and the open connections are dropped.
        server.closeAllConnections();
      });
    },
  };
}

async function serveArtifact(
  basePath: string,
  signer: DownloadUrlSigner,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  logger: Logger,
): Promise<void> {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    let key: string;
    try {
      key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    } catch {
      // Malformed percent-escapes are a client error, not a server fault.
      res.writeHead(404);
      res.end("404 page not found\n");
      return;
    }

    // A live signature over the key, or the same answer a missing key
    // gets: nothing below runs for a link the server did not mint.
    if (!signer.verify(key, url.searchParams)) {
      res.writeHead(404);
      res.end("404 page not found\n");
      return;
    }

    // The same containment guard LocalArtifactStorage applies on writes: a
    // crafted path must never escape the artifact root.
    const root = path.resolve(basePath);
    const filePath = path.resolve(root, key);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(404);
      res.end("404 page not found\n");
      return;
    }

    let info;
    try {
      info = await stat(filePath);
    } catch (error) {
      // Missing is 404. A file that is there but cannot be read (a
      // permission refused, a disk error) is the server's fault, never
      // "not found": a client told 404 takes the artifact for gone
      // (stigmer#1352). The body is static, so no path reaches the wire.
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        res.writeHead(404);
        res.end("404 page not found\n");
        return;
      }
      logger.error("artifact file could not be read", {
        key,
        code,
        error: error instanceof Error ? error.message : String(error),
      });
      res.writeHead(500);
      res.end("500 internal server error\n");
      return;
    }
    if (!info.isFile()) {
      res.writeHead(404);
      res.end("404 page not found\n");
      return;
    }

    const headers: Record<string, string> = {
      "Content-Length": String(info.size),
    };
    // The download query parameter (set by getSignedUrl, and covered by
    // its signature) rides the URL. Absent → inline, no header.
    const downloadName = url.searchParams.get(LOCAL_DOWNLOAD_QUERY_PARAM) ?? "";
    if (downloadName !== "") {
      headers["Content-Disposition"] = contentDispositionAttachment(downloadName);
    }

    res.writeHead(200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(filePath);
    stream.on("error", (error) => {
      logger.error("artifact file stream failed", {
        key,
        error: error.message,
      });
      res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error("artifact file server request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      res.writeHead(500);
    }
    res.end();
  }
}
