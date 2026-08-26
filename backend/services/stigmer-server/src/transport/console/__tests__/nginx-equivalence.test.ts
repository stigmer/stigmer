/**
 * The one-contract gate: proves the console resolver serves every real
 * route to the SAME document as the nginx model in
 * scripts/verify-static-export-routes.mjs — the module that already holds
 * nginx.conf and the App Router route tree together in CI. With this test
 * in the server suite, the repo's two serving implementations (the cloud
 * nginx config and this server's lane 4) cannot drift apart silently: a
 * new route, a changed nginx rule, or a resolver edit that lands them on
 * different documents fails here by name.
 *
 * Hermetic by construction: the export file set is SYNTHESIZED from the
 * enumerated routes via the gate's own exportFileOf (each page's .html
 * plus its .txt flight twin plus /404.html — the gate's out-less mode),
 * so this test never needs a built client-apps/web/out.
 *
 * The RSC flight arms assert against the derived twins directly (the
 * nginx model is NOT the oracle there: nginx never handled flight
 * rewrites — the disclosed cloud-side gap this lane deliberately fixes).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  buildServerModel,
  enumerateRoutes,
  exportFileOf,
  parseNginxConfig,
  representativeUrlOf,
  resolveRequest,
} from "../../../../../../../scripts/verify-static-export-routes.mjs";
import { buildConsoleFileIndex, resolveConsoleRequest } from "../resolver.js";

const repoRoot = new URL("../../../../../../../", import.meta.url);
const webAppDir = fileURLToPath(new URL("client-apps/web/src/app", repoRoot));
const nginxConfPath = fileURLToPath(
  new URL("client-apps/web/nginx.conf", repoRoot),
);

const routes = enumerateRoutes(webAppDir);
const model = buildServerModel(
  parseNginxConfig(readFileSync(nginxConfPath, "utf8")),
);

// The gate's own synthesis (verifyRoutes): every page's .html, its .txt
// flight twin, and the export's always-emitted 404 document.
const files = new Set<string>();
for (const route of routes) {
  const html = exportFileOf(route);
  files.add(html);
  files.add(html.replace(/\.html$/, ".txt"));
}
if (model.errorPage) {
  files.add(model.errorPage.uri);
}
const index = buildConsoleFileIndex(files);

/**
 * The document the TS resolver ultimately serves for a URL: redirects are
 * followed (the browser re-requests), notFound maps to the error page —
 * the same terminal-document view resolveRequest answers for nginx.
 */
function tsResolverDocumentOf(url: string): string | null {
  let pathname = url;
  for (let hop = 0; hop < 6; hop++) {
    const resolution = resolveConsoleRequest(pathname, index);
    switch (resolution.kind) {
      case "file":
        return resolution.file;
      case "redirect":
        pathname = resolution.location;
        continue;
      case "notFound":
        return model.errorPage?.uri ?? null;
      default: {
        const exhaustive: never = resolution;
        throw new Error(`unhandled resolution ${String(exhaustive)}`);
      }
    }
  }
  throw new Error(`redirect loop resolving "${url}"`);
}

describe("console resolver ≡ nginx model (the route-tree equivalence)", () => {
  it("enumerated a non-trivial route tree", () => {
    expect(routes.length).toBeGreaterThan(10);
    expect(routes.some((route) => route.segments.some((s) => s.dynamic))).toBe(
      true,
    );
  });

  it("serves every route's representative URL to the same document as nginx", () => {
    for (const route of routes) {
      const url = representativeUrlOf(route);
      const nginxDocument = resolveRequest(model, url, files);
      expect(tsResolverDocumentOf(url), `route ${route.url} (${url})`).toBe(
        nginxDocument,
      );
      // And both must be the route's own export — anything else is the
      // blank-page class the gate exists to prevent.
      expect(nginxDocument, `route ${route.url} (${url})`).toBe(
        exportFileOf(route),
      );
    }
  });

  it("canonicalizes trailing slashes to the same document as nginx", () => {
    for (const route of routes) {
      if (route.segments.length === 0) continue; // "/" has no slashless twin
      const url = `${representativeUrlOf(route)}/`;
      expect(tsResolverDocumentOf(url), `route ${route.url} (${url})`).toBe(
        resolveRequest(model, url, files),
      );
    }
  });

  it("lands unknown URLs on the error document, like nginx, never the app shell", () => {
    for (const url of [
      "/zz-no-such-route",
      "/zz-no/zz-such",
      "/zz-no/zz-such/zz-route",
      "/zz-no/zz-such/zz-route/zz-deep",
    ]) {
      const nginxDocument = resolveRequest(model, url, files);
      expect(nginxDocument, url).not.toBe("/index.html");
      expect(tsResolverDocumentOf(url), url).toBe(nginxDocument);
    }
  });
});

describe("RSC flight payloads across the whole route tree", () => {
  it("serves every route's flight request its export's .txt twin", () => {
    for (const route of routes) {
      if (route.segments.length === 0) continue; // the root's payloads are literal __next.* files
      const url = `${representativeUrlOf(route)}.txt`;
      const expected = exportFileOf(route).replace(/\.html$/, ".txt");
      const resolution = resolveConsoleRequest(url, index);
      expect(
        resolution.kind === "file" ? resolution.file : resolution.kind,
        `route ${route.url} (${url})`,
      ).toBe(expected);
    }
  });
});
