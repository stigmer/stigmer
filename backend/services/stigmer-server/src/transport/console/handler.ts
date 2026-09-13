/**
 * The console lane — lane 4 of the unified port (DD-005; DD-012 in the
 * parent program's records): serves the web console's static export and
 * synthesizes its runtime /config.json, restoring the local console the
 * June CLI migration lost. Routing decisions live in resolver.ts (pure,
 * nginx-equivalence-gated); this module owns the HTTP half: the lane
 * guard, header policy, config synthesis, and file streaming.
 *
 * /config.json is also how the served console learns to sign in
 * (20260913.02 sp.console-login; stigmer#924): the composition root hands
 * the lane the server's authentication posture (ConsoleSignInPosture) and
 * the lane publishes it in the console's own vocabulary — the OIDC
 * issuer, audience and the console's PKCE client id under the posture,
 * `disabled` under trusted local.
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

/**
 * How the console this lane serves signs in — the server's authentication
 * posture as the console needs to hear it (20260913.02 sp.console-login).
 * A modeled state, never a nullable: "no issuer configured" and "forgot to
 * wire the posture" must stay distinguishable at the call site.
 *
 * Under `oidc`, `consoleClientId` is the PUBLIC client the operator
 * registered for the browser's PKCE flow, or "" when they have not
 * (Q-CL-1): the lane publishes that truth as-is and the console refuses
 * with copy that names the knob (Q-CL-2), while the composition root has
 * already WARNed at wiring time. Emitting `disabled` instead would send
 * the console into every RPC tokenless, to fail with a worse message.
 */
export type ConsoleSignInPosture =
  | { readonly posture: "trusted-local" }
  | {
      readonly posture: "oidc";
      readonly issuer: string;
      readonly audience: string;
      readonly consoleClientId: string;
    };

export interface ConsoleLaneOptions {
  readonly assets: ConsoleAssets;
  readonly signIn: ConsoleSignInPosture;
  readonly logger: Logger;
}

export function createConsoleLane(options: ConsoleLaneOptions): LaneHandler {
  const { assets, signIn, logger } = options;
  // The console's runtime config is a pure function of the posture: one
  // body, built once, served on every request.
  const configJsonBody = JSON.stringify(consoleRuntimeConfig(signIn));

  return (request: LaneRequest, response: LaneResponse): void => {
    const url = request.url ?? "";
    const queryStart = url.indexOf("?");
    const rawPath = queryStart === -1 ? url : url.slice(0, queryStart);
    const query = queryStart === -1 ? "" : url.slice(queryStart);

    if (rawPath === CONFIG_JSON_PATH) {
      serveConfigJson(request, response, configJsonBody);
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
 * env, synthesized here from the server's own knowledge instead (DD-012:
 * the nginx entrypoint script is not ported). The field names are the
 * console's loader's (client-apps/web/src/config/runtime-config.ts).
 *
 * `apiUrl` is the empty string, which the console reads as "my own
 * origin" — the rule its `appUrl` already follows (20260913.02 Q-CL-3).
 * This lane and the RPC lane share one port, so the console can never
 * need a different origin, and it makes the answer right behind a
 * TLS-terminating proxy without trusting x-forwarded-proto: the earlier
 * Host-derived `http://<host>` sent an https-loaded console to an http
 * API and died on mixed content.
 *
 * Every value here is public metadata: an OIDC issuer URL, an audience
 * string and a PKCE client id are what a browser is handed by design.
 */
function consoleRuntimeConfig(signIn: ConsoleSignInPosture): {
  readonly apiUrl: "";
  readonly appUrl: "";
  readonly authMode: "disabled" | "oidc";
  readonly oidcIssuer: string;
  readonly oidcClientId: string;
  readonly oidcAudience: string;
} {
  switch (signIn.posture) {
    case "trusted-local":
      return {
        apiUrl: "",
        appUrl: "",
        authMode: "disabled",
        oidcIssuer: "",
        oidcClientId: "",
        oidcAudience: "",
      };
    case "oidc":
      return {
        apiUrl: "",
        appUrl: "",
        authMode: "oidc",
        oidcIssuer: signIn.issuer,
        oidcClientId: signIn.consoleClientId,
        oidcAudience: signIn.audience,
      };
    default: {
      const exhaustive: never = signIn;
      throw new Error(`unhandled sign-in posture ${String(exhaustive)}`);
    }
  }
}

function serveConfigJson(
  request: LaneRequest,
  response: LaneResponse,
  body: string,
): void {
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
