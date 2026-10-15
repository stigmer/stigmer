/**
 * The sitemap lists every static top-level page the site serves.
 *
 * The routes are read from disk (each `src/app/<route>/page.tsx`), so a page
 * added without a sitemap entry fails here instead of going unlisted, as
 * the pricing, contact, use-case, download and blog pages once did. A
 * dynamic segment and the docs, which the sitemap lists page by page from
 * the docs source, are left out.
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

/** The static top-level routes, e.g. "/pricing", from the app directory. */
function staticRoutes(): readonly string[] {
  return fs
    .readdirSync(APP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith("[") && !name.startsWith("(") && name !== "docs" && name !== "__tests__")
    .filter((name) => fs.existsSync(path.join(APP_DIR, name, "page.tsx")))
    .map((name) => `/${name}`);
}

describe("sitemap", () => {
  it("lists every static top-level page the site serves", () => {
    const urls = sitemap().map((entry) => entry.url);
    const routes = staticRoutes();

    expect(routes).toContain("/pricing");
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
