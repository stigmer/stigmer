/**
 * The console static-export route resolver — the PURE routing half of the
 * unified port's console lane (DD-005 lane 4; DD-012 in the parent
 * program's records). Given a decoded request path and an index of the
 * export's files, it answers WHICH document serves — no I/O, so the
 * contract is exhaustively unit-testable and machine-checkable against
 * the nginx model (see __tests__/nginx-equivalence.test.ts).
 *
 * The contract merges the correct half of each prior implementation:
 *
 * - PAGE resolution reproduces client-apps/web/nginx.conf (the cloud
 *   serving rules, hardened after the channel-conversations F-12
 *   blank-page failures): try the literal file, its `.html` sibling, the
 *   directory index, then the Next.js `__placeholder__.html` candidates —
 *   most-literal first, at most two trailing dynamic segments — and
 *   unknown URLs land on /404.html WITH a 404 status, never the blank app
 *   shell. Trailing slashes 301 to the canonical slashless URL.
 *   scripts/verify-static-export-routes.mjs holds nginx.conf and the route
 *   tree together; the equivalence test holds THIS resolver to the same
 *   model, so the two serving paths cannot drift.
 *
 * - RSC FLIGHT resolution restores the retired Go CLI handler's rewrites
 *   (client-apps/cli/embedded/webconsole/handler.go at 8dc9df7e4~1,
 *   deleted with the June CLI migration): a soft navigation to a dynamic
 *   route fetches `<path>.txt` (and nested `<path>/__next.*.txt`) flight
 *   payloads that exist on disk only in `__placeholder__` form. nginx
 *   never handled these (filed as a cloud-side follow-up); without the
 *   rewrite every soft navigation to a dynamic route degrades to a full
 *   page load. Formulated here as "resolve the stem as a page, serve the
 *   resolved document's twin" — one candidate discipline for both
 *   contracts, which also covers the two-dynamic-segment routes the Go
 *   handler's single-substitution loop predated.
 */

/** The literal Next.js static-export sentinel for dynamic segments. */
const PLACEHOLDER = "__placeholder__";

/** Nested RSC payload files: `__next.<segment-path>.txt` siblings. */
const FLIGHT_SEGMENT_PREFIX = "__next.";

/**
 * The export's files and the directories they imply, both as "/"-rooted,
 * "/"-separated paths (e.g. "/sessions/__placeholder__.html"). Built once
 * per asset root by {@link buildConsoleFileIndex}; filesystem separators
 * are the serving layer's concern, never the resolver's.
 */
export interface ConsoleFileIndex {
  hasFile(path: string): boolean;
  hasDirectory(path: string): boolean;
}

export function buildConsoleFileIndex(
  files: Iterable<string>,
): ConsoleFileIndex {
  const fileSet = new Set<string>();
  // The export root itself is a directory, so "/" resolves through the
  // directory-index candidate (the root route's own serving path).
  const directorySet = new Set<string>(["/"]);
  for (const file of files) {
    fileSet.add(file);
    let parent = file;
    for (;;) {
      const slash = parent.lastIndexOf("/");
      if (slash <= 0) break;
      parent = parent.slice(0, slash);
      if (directorySet.has(parent)) break;
      directorySet.add(parent);
    }
  }
  return {
    hasFile: (path) => fileSet.has(path),
    hasDirectory: (path) => directorySet.has(path),
  };
}

export type ConsoleResolution =
  /** 301 to the canonical URL (the handler carries the query through). */
  | { readonly kind: "redirect"; readonly location: string }
  /** Serve this export file with a 200. */
  | { readonly kind: "file"; readonly file: string }
  /** Serve /404.html (when the export has one) WITH a 404 status. */
  | { readonly kind: "notFound" };

/**
 * Resolve a decoded, query-less request path against the export index.
 * Redirects resolve one step per call, exactly as nginx's single
 * `^(.+)/$` rewrite does — the client (or a test) follows them.
 */
export function resolveConsoleRequest(
  pathname: string,
  index: ConsoleFileIndex,
): ConsoleResolution {
  // Trailing-slash canonicalization (nginx `location ~ ^(.+)/$`): the
  // export writes sibling .html files, never directory indexes, so a
  // trailing-slash deep link would miss every candidate below. "/" itself
  // cannot match (the capture needs one character before the slash).
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return { kind: "redirect", location: pathname.slice(0, -1) };
  }

  const lastSegment = pathname.slice(pathname.lastIndexOf("/") + 1);

  // Nested RSC flight payload: /<dir>/__next.<x>.txt. Direct hits cover
  // static parents (and the root-level __next.*.txt family); otherwise
  // resolve the parent as a page and serve the payload from the resolved
  // (placeholder-substituted) document's directory.
  if (
    lastSegment.startsWith(FLIGHT_SEGMENT_PREFIX) &&
    lastSegment.endsWith(".txt")
  ) {
    if (index.hasFile(pathname)) {
      return { kind: "file", file: pathname };
    }
    const parent = pathname.slice(0, pathname.lastIndexOf("/"));
    const parentDocument = parent === "" ? null : resolvePage(parent, index);
    if (parentDocument !== null && parentDocument.endsWith(".html")) {
      const candidate = `${parentDocument.slice(0, -".html".length)}/${lastSegment}`;
      if (index.hasFile(candidate)) {
        return { kind: "file", file: candidate };
      }
    }
    return { kind: "notFound" };
  }

  // Page-level RSC flight payload: /<path>.txt is the twin of the
  // document /<path> resolves to (the export writes a .txt beside every
  // page's .html). Excludes _next/ internals, which are literal files.
  if (
    lastSegment.endsWith(".txt") &&
    !pathname.startsWith("/_next/") &&
    index.hasFile(pathname) === false
  ) {
    const stemDocument = resolvePage(pathname.slice(0, -".txt".length), index);
    if (stemDocument !== null && stemDocument.endsWith(".html")) {
      const twin = `${stemDocument.slice(0, -".html".length)}.txt`;
      if (index.hasFile(twin)) {
        return { kind: "file", file: twin };
      }
    }
    return { kind: "notFound" };
  }

  const document = resolvePage(pathname, index);
  return document === null
    ? { kind: "notFound" }
    : { kind: "file", file: document };
}

/**
 * The nginx try_files chain, generalized: literal file, `.html` sibling,
 * directory index, then the placeholder candidates — substitute the last
 * segment, then the last two (nginx's declaration order: the more-literal
 * candidate first, mirroring Next.js route priority where a literal
 * segment beats a dynamic one). Returns the served document or null.
 *
 * `/_next/` build assets are literal-only (nginx's `^~ /_next/static/`
 * location has no try_files): the placeholder candidates could never hit
 * there — no export writes placeholder documents under /_next/ — so the
 * short-circuit changes no outcome, it just refuses to pretend those
 * candidates make sense.
 */
function resolvePage(pathname: string, index: ConsoleFileIndex): string | null {
  if (index.hasFile(pathname)) {
    return pathname;
  }
  if (pathname.startsWith("/_next/")) {
    return null;
  }
  if (pathname !== "/" && index.hasFile(`${pathname}.html`)) {
    return `${pathname}.html`;
  }
  // nginx `$uri/` + `index index.html`: a directory serves its index.
  if (index.hasDirectory(pathname)) {
    const indexFile =
      pathname === "/" ? "/index.html" : `${pathname}/index.html`;
    if (index.hasFile(indexFile)) {
      return indexFile;
    }
  }

  const segments = pathname.split("/").filter((segment) => segment !== "");
  for (const dynamicCount of [1, 2]) {
    // Substituting the last k segments needs at least k+1 segments: the
    // nginx regexes require a non-empty static prefix (`(.+)/…`), so a
    // top-level path never resolves through placeholders.
    if (segments.length < dynamicCount + 1) {
      break;
    }
    const candidate = [
      "",
      ...segments.slice(0, -dynamicCount),
      ...Array<string>(dynamicCount).fill(PLACEHOLDER),
    ].join("/");
    if (index.hasFile(`${candidate}.html`)) {
      return `${candidate}.html`;
    }
  }
  return null;
}
