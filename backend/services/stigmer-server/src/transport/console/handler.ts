/**
 * The console lane — lane 4 of the unified port (DD-005; DD-012 in the
 * parent program's records): serves the web console's static export and
 * synthesizes its runtime /config.json, restoring the local console the
 * June CLI migration lost. Routing decisions live in resolver.ts (pure,
 * nginx-equivalence-gated); this module owns the HTTP half: the lane
 * guard, header policy, config synthesis, and file streaming.
 *
 * Lane guard (consoleLaneEligible): the lane claims GET/HEAD only — RPC
 * traffic is POST on service-qualified paths, and OPTIONS preflights keep
 * flowing to the RPC lane's CORS handling — and it never claims:
 *   - `/v1/*`: the registry/skill lanes' namespace; unknown paths there
 *     must keep reaching the adapter's 404 (the CW-10 pinned contract).
 *   - service-shaped paths (`/<package.Service>/<Method>` — exactly two
 *     segments with a dotted first): even though no RPC answers GET today
 *     (zero no_side_effects methods), the adapter must stay the authority
 *     for its own namespace if one ever does.
 *
 * Header policy follows nginx.conf's four explicit postures byte-for-byte
 * (immutable /_next/static/, no-cache index.html, no-store config.json,
 * max-age=300 embed.js). Everything else is served `no-cache` — a
 * deliberate divergence from nginx, which falls back to default validator
 * behavior (ETag/Last-Modified) this handler does not emit; no-cache
 * keeps every document fresh across server upgrades at the cost of
 * revalidating tiny files, while the heavy assets all live under the
 * immutable /_next/static/ rule.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../../boot/logger.js";
import type { LaneHandler, LaneRequest, LaneResponse } from "../lanes.js";
import type { ConsoleAssets } from "./assets.js";
import { resolveConsoleRequest } from "./resolver.js";

/** The runtime-config route the ConfigGate fetches before first render. */
const CONFIG_JSON_PATH = "/config.json";

/** nginx: runtime config must never be cached (config changes propagate immediately). */
const CONFIG_JSON_CACHE_CONTROL = "no-cache, no-store, must-revalidate";

/** nginx: Next.js hashed assets are safe to cache indefinitely. */
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** nginx: the embed loader rides an unversioned URL; a short TTL lets fixes reach embedders in minutes. */
const EMBED_JS_CACHE_CONTROL = "public, max-age=300";

/** Everything else (see the module header for the divergence rationale). */
const DEFAULT_CACHE_CONTROL = "no-cache";

/**
 * Whether the console lane may claim this request. Exported for the lane
 * router (server.ts), which stays a thin if-chain — the guard's knowledge
 * of RPC path shapes belongs to this module.
 */
export function consoleLaneEligible(request: LaneRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }
  const pathname = (request.url ?? "").split("?", 1)[0] ?? "";
  if (pathname === "" || !pathname.startsWith("/")) {
    return false;
  }
  if (pathname.startsWith("/v1/")) {
    return false;
  }
  return !isServiceShapedPath(pathname);
}

/** `/<package.Service>/<Method>` — exactly two segments, dotted first. */
function isServiceShapedPath(pathname: string): boolean {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  return segments.length === 2 && (segments[0] ?? "").includes(".");
}

export interface ConsoleLaneOptions {
  readonly assets: ConsoleAssets;
  /**
   * Fallback port for the synthesized apiUrl when a request carries no
   * Host/:authority (technically possible on HTTP/1.0-style clients).
   */
  readonly grpcPort: number;
  readonly logger: Logger;
}

export function createConsoleLane(options: ConsoleLaneOptions): LaneHandler {
  const { assets, grpcPort, logger } = options;

  return (request: LaneRequest, response: LaneResponse): void => {
    const url = request.url ?? "";
    const queryStart = url.indexOf("?");
    const rawPath = queryStart === -1 ? url : url.slice(0, queryStart);
    const query = queryStart === -1 ? "" : url.slice(queryStart);

    if (rawPath === CONFIG_JSON_PATH) {
      serveConfigJson(request, response, grpcPort);
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(rawPath);
    } catch {
      // Malformed percent-escapes are a client error (the artifact file
      // server's posture); the export's own 404 document still answers.
      serveNotFound(request, response, assets, logger);
      return;
    }

    const resolution = resolveConsoleRequest(pathname, assets.index);
    switch (resolution.kind) {
      case "redirect":
        // Relative Location (nginx absolute_redirect off: an absolute form
        // would embed this listener's port, wrong behind any proxy). The
        // query rides through, as nginx's `$is_args$args` spells out.
        response.statusCode = 301;
        response.setHeader("Location", `${resolution.location}${query}`);
        response.end();
        return;
      case "file":
        serveFile(request, response, assets, resolution.file, 200, logger);
        return;
      case "notFound":
        serveNotFound(request, response, assets, logger);
        return;
      default: {
        const exhaustive: never = resolution;
        throw new Error(`unhandled resolution ${String(exhaustive)}`);
      }
    }
  };
}

/**
 * The runtime config the cloud container's entrypoint.sh generates from
 * env — synthesized here from the server's own knowledge instead (DD-012:
 * the nginx entrypoint script is not ported). apiUrl derives from the
 * request's own Host so the answer is correct wherever the browser
 * reached us from (localhost, a LAN address, a self-host name) — the
 * console cannot express "same origin" itself (its config loader maps
 * empty fields to a localhost default). TLS-terminating proxies
 * (x-forwarded-proto) are out of scope until a tier serves TLS.
 */
function serveConfigJson(
  request: LaneRequest,
  response: LaneResponse,
  grpcPort: number,
): void {
  // HTTP/1.1 carries Host; Node maps HTTP/2's :authority into the same
  // headers view (and Http2ServerRequest.authority falls back to it).
  const host = request.headers.host ?? request.headers[":authority"];
  const apiUrl =
    typeof host === "string" && host !== ""
      ? `http://${host}`
      : `http://localhost:${grpcPort}`;
  const body = JSON.stringify({
    apiUrl,
    appUrl: "",
    authMode: "disabled",
    oidcIssuer: "",
    oidcClientId: "",
    oidcAudience: "",
  });
  response.statusCode = 200;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", CONFIG_JSON_CACHE_CONTROL);
  response.setHeader("Content-Length", String(Buffer.byteLength(body)));
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  response.end(body);
}

function serveNotFound(
  request: LaneRequest,
  response: LaneResponse,
  assets: ConsoleAssets,
  logger: Logger,
): void {
  // The export's real not-found page, WITH the 404 status (nginx
  // error_page semantics) — never the blank app shell, and never the
  // adapter's terse 404 once a console is bundled.
  if (assets.index.hasFile("/404.html")) {
    serveFile(request, response, assets, "/404.html", 404, logger);
    return;
  }
  response.statusCode = 404;
  response.end("404 page not found\n");
}

function serveFile(
  request: LaneRequest,
  response: LaneResponse,
  assets: ConsoleAssets,
  file: string,
  statusCode: number,
  logger: Logger,
): void {
  // Containment by construction: `file` is an INDEX member (produced by
  // the boot-time scan), never raw request input — a traversal path can
  // only miss the index and 404 in the resolver. The join below therefore
  // cannot escape the asset root.
  const filePath = path.join(assets.root, ...file.split("/").filter(Boolean));

  streamFile(request, response, file, filePath, statusCode).catch(
    (error: unknown) => {
      // Detached-async terminal catch (the skill transfer lane's
      // load-bearing pattern): an escape here would be process-fatal.
      logger.error("console lane failed to serve file", {
        file,
        error: error instanceof Error ? error.message : String(error),
      });
      if (!response.headersSent) {
        response.statusCode = 500;
      }
      response.end();
    },
  );
}

async function streamFile(
  request: LaneRequest,
  response: LaneResponse,
  file: string,
  filePath: string,
  statusCode: number,
): Promise<void> {
  // The index said the file exists; a stat failure means the artifact was
  // mutilated underneath us — the terminal catch answers 500.
  const info = await stat(filePath);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", contentTypeOf(file));
  response.setHeader("Cache-Control", cacheControlOf(file, statusCode));
  response.setHeader("Content-Length", String(info.size));
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("error", (error) => {
      response.destroy();
      reject(error);
    });
    response.on("close", () => resolve());
    stream.pipe(response);
  });
}

/**
 * Cache policy keyed on the SERVED document (nginx keys locations on the
 * request URI, but its internal try_files redirects re-enter location
 * matching, so the effective key is the final document there too).
 * nginx's explicit `index.html → no-cache` rule is subsumed by the
 * default here. Only 200 responses carry cache headers beyond the
 * default — nginx's add_header skips error statuses, and a cached 404
 * page would mask a later upgrade that adds the route.
 */
function cacheControlOf(file: string, statusCode: number): string {
  if (statusCode !== 200) {
    return DEFAULT_CACHE_CONTROL;
  }
  if (file.startsWith("/_next/static/")) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  if (file === "/embed.js") {
    return EMBED_JS_CACHE_CONTROL;
  }
  return DEFAULT_CACHE_CONTROL;
}

/**
 * Explicit type map: the artifact file server deliberately omits
 * Content-Type (clients sniff), but a BROWSER document target must be
 * typed — an untyped .html deep link would download instead of render.
 * Extensions are the export's observed inventory; unknowns fall back to
 * octet-stream rather than guessing.
 */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".wasm": "application/wasm",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
};

function contentTypeOf(file: string): string {
  const extension = path.posix.extname(file).toLowerCase();
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
