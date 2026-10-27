#!/usr/bin/env node

/**
 * Static-export routing gate for the web console.
 *
 * The web console ships as a Next.js static export served by nginx
 * (client-apps/web/nginx.conf). Every dynamic route exports one HTML file
 * with the literal `__placeholder__` in each dynamic segment, and nginx's
 * try_files chain must map a real-value request back onto that file. When
 * the mapping misses, the request falls through to /index.html — a page
 * that deliberately renders nothing — and the user sees the app shell with
 * a blank main area. That exact failure shipped before this gate existed
 * (/conversations/[channelId]/[key] among others): nothing in the repo exercised the production serving path, so nginx and
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
 * own page — never on /index.html. It also answers the response headers
 * nginx attaches, because a page that is served right but cached wrong
 * keeps a returning browser on the previous deploy's console.
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
 * The model was validated against real nginx (the production image over a
 * synthesized export tree, and again when redirects, the error page and
 * the response headers landed).
 * Its semantics: exact locations, then ^~ prefix locations, then regex
 * locations in declaration order, then the longest plain prefix;
 * try_files checks all-but-last args as files (trailing `/` means
 * directory) and treats the last as an internal redirect, except a final
 * `=404`, which resolves through the server's `error_page`; a
 * `return 30x <target>` location is followed to the destination document.
 * Headers: the location that finally serves a request (after every
 * internal redirect) sends its own `add_header`s; a location with none
 * inherits the server's, all or nothing, never merged by name; a 404
 * response carries only the `always` ones.
 * Beyond per-route resolution, the gate asserts three standing postures:
 * unknown URLs never serve the blank app shell, trailing-slash URLs
 * reach the same document as their canonical form, and every page and its
 * .txt payload is sent with a Cache-Control that revalidates.
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
      while (pos < text.length && !";{}".includes(text[pos])) {
        // A quoted argument may hold the delimiters (`"public, max-age=300"`).
        if (text[pos] === '"' || text[pos] === "'") {
          const close = text.indexOf(text[pos], pos + 1);
          if (close === -1) {
            throw new Error(
              `nginx.conf parse error: unterminated quote near "${text.slice(start, start + 60).trim()}"`,
            );
          }
          pos = close + 1;
        } else {
          pos++;
        }
      }
      if (pos >= text.length || text[pos] === "}") {
        throw new Error(
          `nginx.conf parse error: unterminated directive near "${text.slice(start, start + 60).trim()}"`,
        );
      }
      const head = [
        ...text.slice(start, pos).matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g),
      ].map((match) => match[1] ?? match[2] ?? match[3]);
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

/**
 * `return` codes the model follows as redirects. Anything else (e.g. a
 * bare status return) is refused until the model learns its semantics.
 */
const REDIRECT_CODES = new Set(["301", "302", "307", "308"]);

/**
 * Query-string variables allowed in `return` targets. The model resolves
 * PATHS (query strings never affect which file serves), so these
 * substitute to the empty string — they exist in the config so real
 * nginx carries the query through the redirect.
 */
const QUERY_VARIABLES = new Set(["is_args", "args"]);

/**
 * Directives that cannot affect which FILE a request resolves to, or
 * which headers it is sent with. `absolute_redirect` shapes the Location
 * header's form (relative vs absolute-with-listen-port — load-bearing
 * behind the ingress), never the destination document this model answers
 * for.
 */
const INERT_SERVER_DIRECTIVES = new Set(["listen", "root", "absolute_redirect"]);

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

  const model = { indexFile: "index.html", locations: [], errorPage: null, headers: [] };

  for (const directive of servers[0].block) {
    if (directive.name === "location") {
      model.locations.push(parseLocation(directive));
    } else if (directive.name === "add_header") {
      addHeader(model.headers, directive);
    } else if (directive.name === "index") {
      if (directive.args.length !== 1) refuse(`multi-argument index directive`);
      model.indexFile = directive.args[0];
    } else if (directive.name === "error_page") {
      // Exactly the `error_page 404 /uri;` shape: one code, one URI
      // (nginx serves that document WITH the error status). Multi-code
      // forms, `=` response-code overrides, and named locations change
      // the semantics and are refused until modelled.
      if (
        directive.args.length !== 2 ||
        directive.args[0] !== "404" ||
        !directive.args[1].startsWith("/")
      ) {
        refuse(`error_page form "${directive.args.join(" ")}"`);
      }
      model.errorPage = { code: 404, uri: directive.args[1] };
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
  let redirect = null;
  const headers = [];
  for (const inner of directive.block ?? []) {
    if (inner.name === "try_files") {
      inner.args.forEach((arg, index) => {
        for (const [, variable] of arg.matchAll(/\$(\w+)/g)) {
          if (!KNOWN_VARIABLES.has(variable)) {
            refuse(`try_files variable "$${variable}"`);
          }
        }
        if (arg.startsWith("=")) {
          // `=404` is modelled ONLY as the final argument, resolving
          // through the server's error_page. Any other code — or a code
          // mid-list, which nginx would ignore — is refused.
          if (arg !== "=404" || index !== inner.args.length - 1) {
            refuse(`try_files code fallback "${arg}" (only a final =404 is modelled)`);
          }
        }
      });
      tryFiles = inner.args;
    } else if (inner.name === "return") {
      // Exactly the `return <redirect-code> <target>;` shape; the model
      // follows it to the document a browser would end up with. Bare
      // status returns and response bodies are different semantics.
      if (inner.args.length !== 2 || !REDIRECT_CODES.has(inner.args[0])) {
        refuse(`return form "${inner.args.join(" ")}"`);
      }
      for (const [, variable] of inner.args[1].matchAll(/\$(\w+)/g)) {
        if (!KNOWN_VARIABLES.has(variable) && !QUERY_VARIABLES.has(variable)) {
          refuse(`return target variable "$${variable}"`);
        }
      }
      redirect = { code: Number(inner.args[0]), target: inner.args[1] };
    } else if (inner.name === "add_header") {
      addHeader(headers, inner);
    } else {
      refuse(`location-level directive "${inner.name}"`);
    }
  }
  if (tryFiles && redirect) {
    refuse(`location with both try_files and return (evaluation order is subtle)`);
  }

  return {
    modifier,
    pattern,
    regex: modifier === "~" ? new RegExp(pattern) : null,
    tryFiles,
    redirect,
    headers,
  };
}

/**
 * Exactly `add_header <name> <literal value> [always];`. A value with a
 * variable, or a name repeated on one level (nginx sends both), is
 * refused until modelled.
 */
function addHeader(headers, directive) {
  const [name, value, flag] = directive.args;
  if (
    value === undefined ||
    directive.args.length > 3 ||
    (flag !== undefined && flag !== "always")
  ) {
    refuse(`add_header form "${directive.args.join(" ")}"`);
  }
  if (value.includes("$")) {
    refuse(`add_header value variable in "${directive.args.join(" ")}"`);
  }
  if (headers.some((header) => header.name.toLowerCase() === name.toLowerCase())) {
    refuse(`add_header "${name}" repeated on one level`);
  }
  headers.push({ name, value, always: flag === "always" });
}

// ---------------------------------------------------------------------------
// Request resolution (nginx location + try_files semantics, modelled)
// ---------------------------------------------------------------------------

/**
 * Resolve a request URI against the server model and a file set, returning
 * the file path the browser ends up with, or `null` (no file and no
 * error page — a bare 404/403 in production).
 *
 * Redirect locations (`return 301 …`) are followed to their destination
 * document; a final `=404` resolves through the server's `error_page`
 * (nginx serves that document WITH the error status — status codes are
 * nginx semantics the one-time real-nginx validation pins, while this
 * model answers "which document?").
 *
 * @param model  From {@link buildServerModel}.
 * @param uri    Decoded request path (no query string).
 * @param files  Set of existing file paths, e.g. "/conversations.html".
 */
export function resolveRequest(model, uri, files, depth = 0) {
  return serve(model, uri, files, depth).file;
}

/**
 * The headers nginx sends with the response to a request: those of the
 * location that finally served it (after internal redirects; a `return`
 * redirect is followed to the destination's response), or the server's
 * when that location declares none. A 404 carries only `always` headers.
 *
 * @returns Header name → value, as written in the config.
 */
export function headersOf(model, uri, files) {
  return headersOfServed(model, serve(model, uri, files));
}

function headersOfServed(model, served) {
  const own = served.location?.headers ?? [];
  const effective = own.length > 0 ? own : model.headers;
  return Object.fromEntries(
    effective
      .filter((header) => served.status === 200 || header.always)
      .map((header) => [header.name, header.value]),
  );
}

/**
 * Resolution with what the response's headers depend on: `{ file,
 * location, status }`, where `location` is the one that finally served
 * the request (`null` when none matched) and `status` is 200 for a file
 * served, 404 for the error page or nothing.
 */
function serve(model, uri, files, depth = 0) {
  if (depth > 5) {
    throw new Error(`internal redirect loop resolving "${uri}"`);
  }

  const directories = directoriesOf(files);
  const location = matchLocation(model, uri);
  const served = (file) => ({ file, location, status: file === null ? 404 : 200 });
  const serveFile = (path) => served(files.has(path) ? path : null);
  const serveErrorPage = () => {
    if (!model.errorPage) return served(null);
    // The error document keeps the 404 status of the request it answers.
    return { ...serve(model, model.errorPage.uri, files, depth + 1), status: 404 };
  };

  if (!location) return serveFile(uri);

  const captures = location.regex ? uri.match(location.regex) : null;
  const substitute = (arg) =>
    arg.replace(/\$(\w+)/g, (whole, variable) => {
      if (variable === "uri") return uri;
      // The model resolves paths without query strings, so the
      // query-carrying variables are empty here.
      if (QUERY_VARIABLES.has(variable)) return "";
      const value = captures?.[Number(variable)];
      if (value === undefined) {
        throw new Error(
          `"${arg}" references $${variable} but location "${location.pattern}" ` +
            `produced no such capture for "${uri}"`,
        );
      }
      return value;
    });

  if (location.redirect) {
    // The browser re-requests the target; model that as a fresh
    // resolution (the depth guard catches redirect loops).
    return serve(model, substitute(location.redirect.target), files, depth + 1);
  }

  if (!location.tryFiles) {
    if (files.has(uri)) return served(uri);
    // Bare directory hit: nginx's index module redirects internally.
    if (directories.has(stripTrailingSlash(uri))) {
      return serve(model, joinUri(uri, model.indexFile), files, depth + 1);
    }
    return served(null);
  }

  const args = location.tryFiles;
  for (const arg of args.slice(0, -1)) {
    const candidate = substitute(arg);
    if (candidate.endsWith("/")) {
      if (directories.has(stripTrailingSlash(candidate))) {
        return serve(model, joinUri(candidate, model.indexFile), files, depth + 1);
      }
    } else if (files.has(candidate)) {
      return served(candidate);
    }
  }
  // The last argument: `=404` resolves through error_page; anything else
  // is an internal redirect re-entering location matching.
  const last = args[args.length - 1];
  if (last === "=404") return serveErrorPage();
  return serve(model, substitute(last), files, depth + 1);
}

/** How a failure names the location that served a request. */
const locationLabel = (location) =>
  location === null
    ? "no location"
    : `location ${location.modifier ? `${location.modifier} ` : ""}${location.pattern}`;

/** Whether a Cache-Control value makes the browser revalidate before reuse. */
const revalidates = (cacheControl) =>
  cacheControl !== undefined &&
  cacheControl
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .some((directive) => directive === "no-cache" || directive === "no-store");

/** The most offenders a coalesced failure names before counting the rest. */
const MAX_NAMED_OFFENDERS = 10;

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
  // The export root always exists as a directory, so "/" must resolve
  // through the `$uri/` candidate and the index directive (this was
  // masked while every chain ended in an /index.html fallback; the
  // =404 ending exposed it).
  const dirs = new Set(["/"]);
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

/** Strip trailing slashes down to a canonical dir path ("/" stays "/"). */
const stripTrailingSlash = (path) => {
  let result = path;
  while (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1);
  return result;
};
const joinUri = (base, name) => {
  const dir = stripTrailingSlash(base);
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
};

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
  // Next.js static export also always emits a root 404 document; the
  // cross-check verifies it against the real artifact.
  const files = new Set();
  for (const route of routes) {
    const html = exportFileOf(route);
    files.add(html);
    files.add(html.replace(/\.html$/, ".txt"));
  }
  if (model.errorPage) files.add(model.errorPage.uri);

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
            ? " — the blank-page failure: the app shell with an empty main area. "
            : ". ") +
          `Fix the dynamic-route fallback in client-apps/web/nginx.conf.`,
      );
    }
  }

  // Not-found posture: an unknown URL must NEVER serve the app shell —
  // /index.html deliberately renders nothing, so the shell under a 200
  // is a blank page that reports success. With an error_page declared,
  // the export's real not-found document must serve instead. One
  // coalesced failure names the offenders.
  const unknownUrls = ["/zz-no-such-route", "/zz-no/zz-such", "/zz-no/zz-such/zz-route"];
  const notFoundOffenders = [];
  for (const url of unknownUrls) {
    let served;
    try {
      served = resolveRequest(model, url, files);
    } catch (error) {
      failures.push(`not-found posture: resolution error on "${url}" — ${error.message}`);
      continue;
    }
    const expectedNotFound = model.errorPage ? model.errorPage.uri : null;
    if (served === "/index.html" || (model.errorPage && served !== expectedNotFound)) {
      notFoundOffenders.push(`"${url}" → ${served ?? "nothing"}`);
    }
  }
  if (notFoundOffenders.length > 0) {
    failures.push(
      `not-found posture: unknown URLs must serve the real not-found page, ` +
        `never the blank app shell — ${notFoundOffenders.join(", ")}. ` +
        `Declare \`error_page 404 /404.html;\` and end the try_files chains ` +
        `in =404 (client-apps/web/nginx.conf).`,
    );
  }

  // Trailing-slash posture: `/x/` must end at the same document as `/x`
  // (the export writes sibling .html files, never directory indexes, so
  // without canonicalization a trailing-slash deep link misses every
  // probe candidate). One coalesced failure names the offenders.
  const slashOffenders = [];
  for (const route of routes) {
    if (route.segments.length === 0) continue; // "/" has no slashless twin
    const url = `${representativeUrlOf(route)}/`;
    let served;
    try {
      served = resolveRequest(model, url, files);
    } catch {
      slashOffenders.push(url);
      continue;
    }
    if (served !== exportFileOf(route)) slashOffenders.push(url);
  }
  if (slashOffenders.length > 0) {
    failures.push(
      `trailing-slash posture: ${slashOffenders.length} route(s) do not reach ` +
        `their document with a trailing slash (e.g. "${slashOffenders[0]}"). ` +
        `Canonicalize with \`location ~ ^(.+)/$ { return 301 $1; }\` ` +
        `(client-apps/web/nginx.conf).`,
    );
  }

  // Revalidation posture: every page, requested by its URL, and its .txt
  // payload, requested by its export path (what in-console navigation
  // fetches), must be sent with a Cache-Control that revalidates. A page
  // the browser may reuse unasked keeps a returning visitor on the
  // previous deploy's console, pointing at chunks the new deploy no
  // longer serves. One coalesced failure names the offenders.
  const staleOffenders = [];
  for (const route of routes) {
    const payload = exportFileOf(route).replace(/\.html$/, ".txt");
    for (const url of [representativeUrlOf(route), payload]) {
      let served;
      try {
        served = serve(model, url, files);
      } catch (error) {
        staleOffenders.push(`${route.url} ("${url}"): resolution error — ${error.message}`);
        continue;
      }
      const headers = headersOfServed(model, served);
      const name = Object.keys(headers).find((key) => key.toLowerCase() === "cache-control");
      const cacheControl = name === undefined ? undefined : headers[name];
      if (!revalidates(cacheControl)) {
        staleOffenders.push(
          `${route.url} ("${url}", served by ${locationLabel(served.location)}): ` +
            (cacheControl === undefined ? "no Cache-Control" : `Cache-Control "${cacheControl}"`),
        );
      }
    }
  }
  if (staleOffenders.length > 0) {
    const rest = staleOffenders.length - MAX_NAMED_OFFENDERS;
    failures.push(
      `revalidation posture: ${staleOffenders.length} page(s) or payload(s) can be ` +
        `reused from the browser's cache without revalidating, so a returning ` +
        `browser keeps the previous deploy's console — ` +
        staleOffenders.slice(0, MAX_NAMED_OFFENDERS).join("; ") +
        (rest > 0 ? `; and ${rest} more` : "") +
        `. Declare \`add_header Cache-Control "no-cache";\` at server level ` +
        `(client-apps/web/nginx.conf), or give the location that serves them ` +
        `its own revalidating Cache-Control.`,
    );
  }

  return failures;
}

/**
 * Cross-check the derived export set against a real `out/` build, in both
 * directions. Validates the derivation itself whenever the artifact exists;
 * a stale build is reported with the rebuild remedy rather than guessed
 * around.
 */
export function crossCheckExport(routes, exportDir, model = null) {
  const failures = [];
  const derived = new Set(routes.map(exportFileOf));

  // The error page the serving rules point at must really exist in the
  // artifact — Next.js emits /404.html for static exports today, and
  // this is where we would learn if that ever stops being true.
  if (model?.errorPage && !existsSync(join(exportDir, model.errorPage.uri.slice(1)))) {
    failures.push(
      `nginx.conf's error_page ${model.errorPage.uri} is missing from ` +
        `${relative(root, exportDir)}`,
    );
  }

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
  if (hasExport) failures.push(...crossCheckExport(routes, EXPORT_DIR, model));

  const dynamicCount = routes.filter((r) =>
    r.segments.some((s) => s.dynamic),
  ).length;

  if (failures.length > 0) {
    console.error(`  FAIL (${failures.length})`);
    for (const failure of failures) console.error(`       ${failure}`);
    console.error(
      `\nverify-static-export-routes: FAIL — a deep link, a hard reload or a ` +
        `returning browser would be served the wrong page in production.\n`,
    );
    process.exit(1);
  }

  console.log(
    `verify-static-export-routes: OK — ${routes.length} routes ` +
      `(${dynamicCount} dynamic) all resolve and revalidate` +
      `${hasExport ? ", export cross-check clean" : " (no out/ build present; hermetic mode)"}.\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
