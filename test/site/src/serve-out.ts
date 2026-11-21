// A static file server for the site's export (site/out), answering URLs the
// way the site's host does, so the audit reads each page at the address a
// visitor uses.
// Domain: test machinery (the site suite's web server).
//
// The export has no trailing-slash pages (site/next.config.ts sets none):
// `/docs/sdk/ink` is `docs/sdk/ink.html`, and `/docs` has both `docs.html`
// and a `docs/` folder. Production serves it through Cloudflare's
// `html_handling: "auto-trailing-slash"` and `not_found_handling: "404-page"`
// (site/wrangler.jsonc), and this server answers the same way: the exact
// file, then `<path>.html`, then `<path>/index.html`, and an unknown path is
// `404.html` with status 404. A path that leaves the folder is refused.
//
// It imports only `node:*` and is TypeScript that Node runs with no build,
// so the suite's config starts it with bare `node`:
//
//   node src/serve-out.ts <folder> <port>

import { createReadStream, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The content types of the files a static export holds; anything else is served as bytes. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** What a request path resolves to: a file and the status to serve it with, or a refusal with no file. */
export type Resolution =
  | { readonly kind: "file"; readonly file: string; readonly status: 200 | 404 }
  | { readonly kind: "refused"; readonly status: 400 | 404 };

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolves a request's path (the URL's pathname, still percent-encoded)
 * against the export folder by the host's rules. Reads the file system, writes nothing.
 */
export function resolvePath(root: string, pathname: string): Resolution {
  const base = resolve(root);
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: "refused", status: 400 };
  }
  if (decoded.includes("\0") || !decoded.startsWith("/")) return { kind: "refused", status: 400 };

  const inside = (candidate: string): string | undefined => {
    const full = resolve(base, `.${candidate}`);
    return full === base || full.startsWith(base + sep) ? full : undefined;
  };
  if (inside(decoded) === undefined) return { kind: "refused", status: 400 };

  const candidates = decoded.endsWith("/")
    ? [`${decoded}index.html`, ...(decoded === "/" ? [] : [`${decoded.slice(0, -1)}.html`])]
    : [decoded, `${decoded}.html`, `${decoded}/index.html`];
  for (const candidate of candidates) {
    const full = inside(candidate);
    if (full !== undefined && isFile(full)) return { kind: "file", file: full, status: 200 };
  }

  const notFound = resolve(base, "404.html");
  return isFile(notFound) ? { kind: "file", file: notFound, status: 404 } : { kind: "refused", status: 404 };
}

/** The content type a file is served with, by its extension. Pure. */
export function contentTypeOf(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

/** Starts the server on `host:port` (port 0 picks a free one) and resolves once it listens. */
export function serveOut(root: string, port: number, host = "127.0.0.1"): Promise<Server> {
  const server = createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" }).end();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const resolution = resolvePath(root, pathname);
    if (resolution.kind === "refused") {
      response.writeHead(resolution.status, { "content-type": "text/plain; charset=utf-8" }).end(resolution.status === 404 ? "Not found\n" : "Bad request\n");
      return;
    }
    response.writeHead(resolution.status, { "content-type": contentTypeOf(resolution.file), "cache-control": "no-store" });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(resolution.file)
      .on("error", () => response.destroy())
      .pipe(response);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      done(server);
    });
  });
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, port] = process.argv.slice(2);
  if (root === undefined || port === undefined || !/^\d+$/.test(port)) {
    console.error("usage: node src/serve-out.ts <folder> <port>");
    process.exit(2);
  }
  const server = await serveOut(root, Number(port));
  const address = server.address();
  const bound = typeof address === "object" && address !== null ? address.port : port;
  console.log(`serving ${resolve(root)} on http://127.0.0.1:${bound}`);
}
