import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { LIBRARY_RESOURCE_TYPES } from "@/domain/library/library-navigation";

// These tests pin two bug classes specific to static-export deployments
// (`output: "export"`), both of which shipped before being caught
// (cloud#274). Neither is covered by scripts/verify-static-export-routes.mjs,
// which verifies that EXISTING routes are servable — not that a route that
// should exist does, nor that a redirect's baked target is usable.

// Vitest runs with cwd at the workspace root (client-apps/web). Resolved
// via cwd rather than import.meta.url because happy-dom rewrites module
// URLs to a non-file scheme.
const SRC_DIR = resolve(process.cwd(), "src");
const APP_DIR = join(SRC_DIR, "app");
if (!existsSync(APP_DIR)) {
  throw new Error(
    `Expected the Next.js app dir at ${APP_DIR} — run this suite from ` +
      `client-apps/web (npm run test -w client-apps/web).`,
  );
}

describe("library deep-link pages", () => {
  // Soft navigation (library-navigation.tsx) fills the URL bar with
  // /library/<type>/<org>/<slug> for every resource type it knows. A cold
  // load of that URL — reload, bookmark, shared link — is served from the
  // static export, which only contains routes with a page file. A type
  // navigable in-app but missing its page file ships a 404 (cloud#274:
  // workflows was navigable for months with no deep-link page).
  for (const resourceType of LIBRARY_RESOURCE_TYPES) {
    it(`${resourceType} has a deep-link detail page`, () => {
      const pageFile = join(
        APP_DIR,
        "library",
        resourceType,
        "[org]",
        "[slug]",
        "page.tsx",
      );
      expect(
        existsSync(pageFile),
        `Missing ${pageFile.slice(SRC_DIR.length)} — "${resourceType}" is ` +
          `soft-navigable (library-navigation.tsx) but a cold load of its ` +
          `detail URL will 404 in the static export. Create the page file ` +
          `(see the agents sibling for the pattern).`,
      ).toBe(true);
    });
  }
});

describe("no server redirect() under dynamic segments", () => {
  // In static export, a page renders exactly once at build time, so a
  // server-component redirect() whose target is built from dynamic params
  // bakes a fixed, wrong target into the exported document (observed as
  // /library/workflows/undefined/undefined). Redirects on dynamic routes
  // must recover params from the browser URL instead — see
  // useLegacyPathRedirect and the LegacyWorkflowRedirects components.
  const NAVIGATION_IMPORT_RE =
    /import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*["']next\/navigation["']/g;

  function collectDynamicPageFiles(dir: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        found.push(...collectDynamicPageFiles(fullPath));
      } else if (entry.name === "page.tsx" && fullPath.includes("[")) {
        found.push(fullPath);
      }
    }
    return found;
  }

  it("dynamic-route pages do not import redirect from next/navigation", () => {
    const offenders: string[] = [];
    for (const pageFile of collectDynamicPageFiles(APP_DIR)) {
      const content = readFileSync(pageFile, "utf8");
      for (const match of content.matchAll(NAVIGATION_IMPORT_RE)) {
        if (/\b(redirect|permanentRedirect)\b/.test(match[1])) {
          offenders.push(pageFile.slice(SRC_DIR.length));
        }
      }
    }
    expect(
      offenders,
      `Server redirect() on a dynamic route bakes its params at build time ` +
        `in static export (the params are placeholders, so the target is ` +
        `garbage). Use a client-side redirect that reads the real URL ` +
        `instead — useLegacyPathRedirect has the pattern. Offenders: ` +
        offenders.join(", "),
    ).toEqual([]);
  });
});
