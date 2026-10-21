/**
 * The sitemap lists every static page the site serves.
 *
 * The routes are read from disk (each `page.tsx` under `src/app`, at any
 * depth), so a page added without a sitemap entry fails here instead of
 * going unlisted, as the pricing, contact, use-case, download and blog pages
 * once did. Anything under a dynamic segment and the docs, which the sitemap
 * lists page by page from the docs source, is left out.
 */
import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_CONFIG } from "@/lib/constants";
import sitemap from "../sitemap";

vi.mock("@/lib/source", () => ({
  source: { getPages: () => [{ url: "/docs/getting-started/quickstart" }] },
}));

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The static routes below the root, e.g. "/pricing" or "/compare/x", from the app directory. */
function staticRoutes(dir = APP_DIR, prefix = ""): readonly string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("[") && !name.startsWith("(") && name !== "__tests__")
    .filter((name) => !(prefix === "" && name === "docs"))
    .flatMap((name) => {
      const route = `${prefix}/${name}`;
      const own = fs.existsSync(path.join(dir, name, "page.tsx")) ? [route] : [];
      return [...own, ...staticRoutes(path.join(dir, name), route)];
    });
}

describe("sitemap", () => {
  it("lists every static page the site serves", () => {
    const urls = sitemap().map((entry) => entry.url);
    const routes = staticRoutes();

    expect(routes).toContain("/pricing");
    expect(routes).toContain("/compare/claude-managed-agents");
    for (const route of routes) {
      expect(urls).toContain(`${SITE_CONFIG.url}${route}`);
    }
    expect(urls).toContain(SITE_CONFIG.url);
  });

  it("lists the docs pages from the docs source", () => {
    expect(sitemap().map((entry) => entry.url)).toContain(
      `${SITE_CONFIG.url}/docs/getting-started/quickstart`,
    );
  });
});
