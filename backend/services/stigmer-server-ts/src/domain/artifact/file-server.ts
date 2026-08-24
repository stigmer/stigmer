/**
 * The artifact HTTP file server — ports the local-download lane from Go
 * pkg/server/server.go (artifactDownloadHandler + the boot block, lines
 * 849–926): a second listener on 127.0.0.1:ARTIFACT_HTTP_PORT (default
 * grpcPort+1), started only when artifact storage is LOCAL, serving
 * GET /<key> as the exact bytes LocalArtifactStorage wrote. The lane
 * dissolved into its owning domain per the ratified D4 decision — it is
 * NOT a unified-port lane (Go runs it as a separate listener, and so does
 * this port).
 *
 * Disposition contract (proven by the artifact suite's file-server block):
 * a request carrying ?download=<name> (set by getSignedUrl) is served as a
 * browser download named by that parameter — mirroring the R2 backend,
 * which signs Content-Disposition into the presigned URL. Requests without
 * the parameter are served INLINE with no disposition header.
 *
 * Two disclosed nuances versus Go's http.FileServer (neither pinned by the
 * suite, both recorded in the PR):
 *   - No Content-Type header: Go sniffs one (net/http DetectContentType);
 *     porting the whole sniffing algorithm for an unpinned header is not
 *     parity the register demands, and an absent header lets clients apply
 *     the same sniffing themselves.
 *   - No Range support: range requests are answered with the full body
 *     (200), which HTTP permits; Go's ServeContent honors them.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

import { contentDispositionAttachment, LOCAL_DOWNLOAD_QUERY_PARAM } from "../../artifactstorage/artifact-storage.js";
import type { Logger } from "../../boot/logger.js";

export interface ArtifactFileServerOptions {
  /** The artifact root — the base path IS the root (#285). */
  readonly basePath: string;
  readonly logger: Logger;
}

export interface ArtifactFileServer {
  /** Binds 127.0.0.1:<port> (an explicit port 0 picks ephemeral for tests). */
  listen(port: number): Promise<number>;
  shutdown(): Promise<void>;
}

export function createArtifactFileServer(
  options: ArtifactFileServerOptions,
): ArtifactFileServer {
  const { basePath, logger } = options;

  const server = http.createServer((req, res) => {
    void serveArtifact(basePath, req, res, logger);
  });

  return {
    listen(port: number): Promise<number> {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        // Loopback-only, as Go binds "127.0.0.1:<port>": download URLs are
        // minted for the local machine, never a network interface.
        server.listen(port, "127.0.0.1", () => {
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
        // In-flight downloads do not hold shutdown open (Go's file server
        // is simply abandoned on exit; close() at least stops the listener).
        server.closeAllConnections();
      });
    },
  };
}

async function serveArtifact(
  basePath: string,
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
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

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
    } catch {
      res.writeHead(404);
      res.end("404 page not found\n");
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
    // The download query parameter (set by getSignedUrl) rides the URL
    // because the local lane has no presigning; applied here exactly as
    // Go's artifactDownloadHandler does. Absent → inline, no header.
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

/**
 * Go warnOnLegacyArtifactLayout: a one-line migration hint when a
 * pre-#285 store layout is detected (base was a PARENT; artifacts lived at
 * <base>/artifacts/<key>). Keys off the two subpaths only the OLD layout
 * produces — <base>/artifacts/attachments and the doubled
 * <base>/artifacts/artifacts — so it cannot false-positive on a healthy
 * new-layout install.
 */
export async function warnOnLegacyArtifactLayout(
  basePath: string,
  logger: Logger,
): Promise<void> {
  for (const sub of ["attachments", "artifacts"]) {
    const legacy = path.join(basePath, "artifacts", sub);
    try {
      const info = await stat(legacy);
      if (info.isDirectory()) {
        logger.warn(
          "Detected artifacts under a pre-#285 layout at <base>/artifacts/*. " +
            "The artifact root is now <base> itself. Move <base>/artifacts/* up into " +
            "<base> (or set ARTIFACT_LOCAL_BASE_PATH to the old <base>/artifacts) so " +
            "existing artifacts remain reachable.",
          {
            legacyDir: path.join(basePath, "artifacts"),
            artifactRoot: basePath,
          },
        );
        return;
      }
    } catch {
      // Absent legacy path: the healthy case.
    }
  }
}
