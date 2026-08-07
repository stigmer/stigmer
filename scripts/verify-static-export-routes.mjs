#!/usr/bin/env node

/**
 * Static-export routing gate for the web console (channel-conversations F-12).
 *
 * The web console ships as a Next.js static export served by nginx
 * (client-apps/web/nginx.conf). Every dynamic route exports one HTML file
 * with the literal `__placeholder__` in each dynamic segment, and nginx's
 * try_files chain must map a real-value request back onto that file. When
 * the mapping misses, the request falls through to /index.html — a page
 * that deliberately renders nothing — and the user sees the app shell with
 * a blank main area. That exact failure shipped twice before this gate
 * existed (/conversations/[channelId]/[key] and /workflows/[org]/[slug]):
 * nothing in the repo exercised the production serving path, so nginx and
 * the route tree drifted apart silently.
 *
 * This gate re-derives both sides from their sources of truth on every run:
 *
 *   1. The route tree, enumerated from client-apps/web/src/app.
 *   2. The serving rules, parsed from the real nginx.conf (never a copy).
 *
 * It then resolves a representative real-value URL for every route through
 * a model of nginx's location/try_files semantics and asserts each dynamic
 * route lands on its own placeholder file — and each static route on its
 * own page — never on /index.html.
 *
 * Trustworthiness rules, so the model can never silently diverge from the
 * config it judges:
 *
 *   - The parser REFUSES to run (hard failure, not a skip) on any nginx
 *     directive, location modifier, or try_files variable it does not
 *     model. Growing nginx.conf means growing this gate in the same change.
 *   - The route enumerator refuses on App Router constructs it does not
 *     model (catch-all segments, route groups, parallel routes).
 *   - When a real export exists (client-apps/web/out, built by
 *     `npm run build -w client-apps/web`), the derived file set is
 *     cross-checked against it in both directions, so the derivation
 *     itself is validated whenever the artifact is available.
 *
 * The model was validated once against real nginx (the production image
 * over a synthesized export tree; see the T06 Sitting 2b task record in
 * stigmer-cloud). Its semantics: exact locations, then ^~ prefix locations,
 * then regex locations in declaration order, then the longest plain prefix;
 * try_files checks all-but-last args as files (trailing `/` means
 * directory) and treats the last as an internal redirect.
 *
 * Usage:
 *   node scripts/verify-static-export-routes.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB_APP_DIR = join(root, "client-apps/web/src/app");
const NGINX_CONF = join(root, "client-apps/web/nginx.conf");
const EXPORT_DIR = join(root, "client-apps/web/out");

const PLACEHOLDER = "__placeholder__";

/**
 * The most dynamic trailing segments any route may have. nginx.conf's
 * dynamic-route fallback probes one placeholder candidate per possible
 * static-prefix length, so this bound and the candidate list must grow
 * together — the gate fails loudly when a route exceeds it.
 */
const MAX_DYNAMIC_SEGMENTS = 2;

// ---------------------------------------------------------------------------
// Route enumeration (source of truth: the App Router directory tree)
// ---------------------------------------------------------------------------

/**
 * Enumerate every route in an App Router directory as a list of
 * `{ url, segments, pageFile }`, where each segment is
 * `{ name, dynamic }`. Refuses on router constructs the gate does not
 * model rather than guessing at their URL shape.
 */
export function enumerateRoutes(appDir) {
  const routes = [];

  const walk = (dir, segments) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (/^\[\[?\.\.\./.test(name)) {
        throw new Error(
          `unmodelled route construct: catch-all segment "${name}" under ` +
            `${relative(root, dir)}. Teach this gate (and nginx.conf) its ` +
            `export shape before adding catch-all routes.`,
        );
      }
      if (name.startsWith("(") || name.startsWith("@")) {
        throw new Error(
          `unmodelled route construct: "${name}" under ${relative(root, dir)} ` +
            `(route groups and parallel routes change the URL/file mapping). ` +
            `Teach this gate the mapping before using them.`,
        );
      }
      const dynamic = name.startsWith("[") && name.endsWith("]");
      walk(join(dir, name), [
        ...segments,
        { name: dynamic ? name.slice(1, -1) : name, dynamic },
      ]);
    }

    const pageFile = join(dir, "page.tsx");
    if (existsSync(pageFile)) {
      routes.push({
        url: "/" + segments.map((s) => (s.dynamic ? `[${s.name}]` : s.name)).join("/"),
        segments,
        pageFile: relative(root, pageFile),
      });
    }
  };

  walk(appDir, []);
  return routes.sort((a, b) => a.url.localeCompare(b.url));
}

/**
 * The HTML file a route's static export produces: dynamic segments become
 * the literal placeholder (each route's generateStaticParams contract),
 * and the path gains `.html` (`trailingSlash` is unset, so the export
 * writes sibling files, not directory indexes). The root route is the one
 * exception: it exports `/index.html`.
 */
export function exportFileOf(route) {
  if (route.segments.length === 0) return "/index.html";
  return (
    "/" +
    route.segments.map((s) => (s.dynamic ? PLACEHOLDER : s.name)).join("/") +
    ".html"
  );
}

/** A real-value request URL for a route — what a browser actually asks for. */
export function representativeUrlOf(route) {
  if (route.segments.length === 0) return "/";
  return (
    "/" +
    route.segments
      .map((s) => (s.dynamic ? `zz-${s.name.toLowerCase()}` : s.name))
      .join("/")
  );
}

// ---------------------------------------------------------------------------
// nginx.conf parsing (source of truth: the shipped config, never a copy)
// ---------------------------------------------------------------------------

/** Parse nginx config text into `{ name, args, block? }` nodes. */
export function parseNginxConfig(source) {
  const text = source
    .split("\n")
    .map((line) => {
      const hash = line.indexOf("#");
      return hash === -1 ? line : line.slice(0, hash);
    })
    .join("\n");

  let pos = 0;
  const parseNodes = (inBlock) => {
    const nodes = [];
    for (;;) {
      while (pos < text.length && /\s/.test(text[pos])) pos++;
      if (pos >= text.length) {
        if (inBlock) throw new Error("nginx.conf parse error: missing '}'");
        return nodes;
      }
      if (text[pos] === "}") {
        if (!inBlock) throw new Error("nginx.conf parse error: unexpected '}'");
        pos++;
        return nodes;
      }
      const start = pos;
      while (pos < text.length && !";{}".includes(text[pos])) pos++;
      if (pos >= text.length || text[pos] === "}") {
        throw new Error(
          `nginx.conf parse error: unterminated directive near "${text.slice(start, start + 60).trim()}"`,
        );
      }
      const head = text.slice(start, pos).trim().split(/\s+/);
      const delimiter = text[pos];
      pos++;
      nodes.push(
        delimiter === ";"
          ? { name: head[0], args: head.slice(1) }
          : { name: head[0], args: head.slice(1), block: parseNodes(true) },
      );
    }
  };
  return parseNodes(false);
}

/** try_files variables the resolution model understands. */
const KNOWN_VARIABLES = new Set(["uri", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** Directives that cannot affect which file a request resolves to. */
const INERT_SERVER_DIRECTIVES = new Set(["listen", "root"]);
const INERT_LOCATION_DIRECTIVES = new Set(["add_header"]);

const refuse = (message) => {
  throw new Error(
    `nginx.conf uses a construct this gate does not model: ${message}. ` +
      `Extend scripts/verify-static-export-routes.mjs in the same change — ` +
      `an unmodelled config would make this gate silently meaningless.`,
  );
};

/**
 * Build the routing model from parsed config nodes, refusing anything the
 * resolver does not implement.
 */
export function buildServerModel(nodes) {
  const servers = nodes.filter((n) => n.name === "server");
  if (servers.length !== 1 || nodes.length !== 1) {
    refuse(`expected exactly one top-level server block`);
  }

  const model = { indexFile: "index.html", locations: [] };

  for (const directive of servers[0].block) {
    if (directive.name === "location") {
      model.locations.push(parseLocation(directive));
    } else if (directive.name === "index") {
      if (directive.args.length !== 1) refuse(`multi-argument index directive`);
      model.indexFile = directive.args[0];
    } else if (!INERT_SERVER_DIRECTIVES.has(directive.name)) {
      refuse(`server-level directive "${directive.name}"`);
    }
  }
  return model;
}

function parseLocation(directive) {
  let [modifier, pattern] = directive.args;
  if (pattern === undefined) {
    pattern = modifier;
    modifier = "";
  }
  if (!["", "=", "^~", "~"].includes(modifier)) {
    refuse(`location modifier "${modifier}"`);
  }

  let tryFiles = null;
  for (const inner of directive.block ?? []) {
    if (inner.name === "try_files") {
      for (const arg of inner.args) {
        for (const [, variable] of arg.matchAll(/\$(\w+)/g)) {
          if (!KNOWN_VARIABLES.has(variable)) {
            refuse(`try_files variable "$${variable}"`);
          }
        }
        if (arg.startsWith("=")) refuse(`try_files code fallback "${arg}"`);
      }
      tryFiles = inner.args;
    } else if (!INERT_LOCATION_DIRECTIVES.has(inner.name)) {
      refuse(`location-level directive "${inner.name}"`);
    }
  }

  return {
    modifier,
    pattern,
    regex: modifier === "~" ? new RegExp(pattern) : null,
    tryFiles,
  };
}

// ---------------------------------------------------------------------------
// Request resolution (nginx location + try_files semantics, modelled)
// ---------------------------------------------------------------------------

/**
 * Resolve a request URI against the server model and a file set, returning
 * the file path served or `null` (no file — a 404/403 in production).
 *
 * @param model  From {@link buildServerModel}.
 * @param uri    Decoded request path (no query string).
 * @param files  Set of existing file paths, e.g. "/conversations.html".
 */
export function resolveRequest(model, uri, files, depth = 0) {
  if (depth > 5) {
    throw new Error(`internal redirect loop resolving "${uri}"`);
  }

  const directories = directoriesOf(files);
  const location = matchLocation(model, uri);
  const serveFile = (path) => (files.has(path) ? path : null);

  if (!location) return serveFile(uri);

  if (!location.tryFiles) {
    if (files.has(uri)) return uri;
    // Bare directory hit: nginx's index module redirects internally.
    if (directories.has(stripTrailingSlash(uri))) {
      return resolveRequest(
        model,
        joinUri(uri, model.indexFile),
        files,
        depth + 1,
      );
    }
    return null;
  }

  const captures = location.regex ? uri.match(location.regex) : null;
  const substitute = (arg) =>
    arg.replace(/\$(\w+)/g, (whole, variable) => {
      if (variable === "uri") return uri;
      const value = captures?.[Number(variable)];
      if (value === undefined) {
        throw new Error(
          `try_files references $${variable} but location "${location.pattern}" ` +
            `produced no such capture for "${uri}"`,
        );
      }
      return value;
    });

  const args = location.tryFiles;
  for (const arg of args.slice(0, -1)) {
    const candidate = substitute(arg);
    if (candidate.endsWith("/")) {
      if (directories.has(stripTrailingSlash(candidate))) {
        return resolveRequest(
          model,
          joinUri(candidate, model.indexFile),
          files,
          depth + 1,
        );
      }
    } else if (files.has(candidate)) {
      return candidate;
    }
  }
  // Last argument is an internal redirect, re-entering location matching.
  return resolveRequest(model, substitute(args[args.length - 1]), files, depth + 1);
}

function matchLocation(model, uri) {
  let longestPrefix = null;
  for (const location of model.locations) {
    if (location.modifier === "=" && location.pattern === uri) return location;
    if (
      (location.modifier === "" || location.modifier === "^~") &&
      uri.startsWith(location.pattern) &&
      (longestPrefix === null ||
        location.pattern.length > longestPrefix.pattern.length)
    ) {
      longestPrefix = location;
    }
  }
  if (longestPrefix?.modifier === "^~") return longestPrefix;
  for (const location of model.locations) {
    if (location.regex?.test(uri)) return location;
  }
  return longestPrefix;
}

function directoriesOf(files) {
  const dirs = new Set();
  for (const file of files) {
    let path = file;
    for (;;) {
      const slash = path.lastIndexOf("/");
      if (slash <= 0) break;
      path = path.slice(0, slash);
      if (dirs.has(path)) break;
      dirs.add(path);
    }
  }
  return dirs;
}

const stripTrailingSlash = (path) =>
  path.endsWith("/") ? path.slice(0, -1) : path;
const joinUri = (base, name) => `${stripTrailingSlash(base)}/${name}`;

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Run every assertion; returns a list of failure strings (empty = pass).
 * Exported so the sibling node:test suite can drive it against fixture
 * configs, including the historical broken one.
 */
export function verifyRoutes(routes, model) {
  const failures = [];

  const overBudget = routes.filter(
    (route) =>
      route.segments.filter((s) => s.dynamic).length > MAX_DYNAMIC_SEGMENTS,
  );
  for (const route of overBudget) {
    failures.push(
      `${route.url} has more than ${MAX_DYNAMIC_SEGMENTS} dynamic segments. ` +
        `nginx.conf's dynamic-route fallback probes one placeholder candidate per ` +
        `static-prefix length up to that bound — add the deeper candidate there ` +
        `and raise MAX_DYNAMIC_SEGMENTS here, in the same change.`,
    );
  }

  // The export set the routes imply: every page's .html plus its .txt RSC
  // payload sibling (requests for those must keep resolving via $uri).
  const files = new Set();
  for (const route of routes) {
    const html = exportFileOf(route);
    files.add(html);
    files.add(html.replace(/\.html$/, ".txt"));
  }

  for (const route of routes) {
    const url = representativeUrlOf(route);
    const expected = exportFileOf(route);
    let served;
    try {
      served = resolveRequest(model, url, files);
    } catch (error) {
      failures.push(`${route.url}: resolution error — ${error.message}`);
      continue;
    }
    if (served !== expected) {
      failures.push(
        `${route.url}: request "${url}" serves ${served ?? "nothing (404)"} ` +
          `instead of ${expected}` +
          (served === "/index.html"
            ? " — the blank-page failure (channel-conversations F-12). "
            : ". ") +
          `Fix the dynamic-route fallback in client-apps/web/nginx.conf.`,
      );
    }
  }

  return failures;
}

/**
 * Cross-check the derived export set against a real `out/` build, in both
 * directions. Validates the derivation itself whenever the artifact exists;
 * a stale build is reported with the rebuild remedy rather than guessed
 * around.
 */
export function crossCheckExport(routes, exportDir) {
  const failures = [];
  const derived = new Set(routes.map(exportFileOf));

  for (const file of derived) {
    if (!existsSync(join(exportDir, file.slice(1)))) {
      failures.push(
        `derived export file ${file} is missing from ${relative(root, exportDir)}`,
      );
    }
  }

  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === `${PLACEHOLDER}.html`) {
        const file = "/" + relative(exportDir, full).split("\\").join("/");
        if (!derived.has(file)) {
          failures.push(
            `${relative(root, full)} exists in the export but no enumerated route produces it`,
          );
        }
      }
    }
  };
  walk(exportDir);

  if (failures.length > 0) {
    failures.push(
      `(cross-check ran against ${relative(root, exportDir)} — if it is stale, ` +
        `rebuild with \`npm run build -w client-apps/web\` or remove it)`,
    );
  }
  return failures;
}

function main() {
  console.log(
    "\nverify-static-export-routes: web routes vs nginx serving rules\n",
  );

  const routes = enumerateRoutes(WEB_APP_DIR);
  const model = buildServerModel(
    parseNginxConfig(readFileSync(NGINX_CONF, "utf8")),
  );

  const failures = verifyRoutes(routes, model);

  const hasExport =
    existsSync(EXPORT_DIR) && statSync(EXPORT_DIR).isDirectory();
  if (hasExport) failures.push(...crossCheckExport(routes, EXPORT_DIR));

  const dynamicCount = routes.filter((r) =>
    r.segments.some((s) => s.dynamic),
  ).length;

  if (failures.length > 0) {
    console.error(`  FAIL (${failures.length})`);
    for (const failure of failures) console.error(`       ${failure}`);
    console.error(
      `\nverify-static-export-routes: FAIL — a deep link or hard reload would ` +
        `render a blank page in production.\n`,
    );
    process.exit(1);
  }

  console.log(
    `verify-static-export-routes: OK — ${routes.length} routes ` +
      `(${dynamicCount} dynamic) all resolve` +
      `${hasExport ? ", export cross-check clean" : " (no out/ build present; hermetic mode)"}.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
