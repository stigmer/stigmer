/**
 * The sitemap lists every page the site serves.
 *
 * The routes are read from disk (each `page.tsx` under `src/app`, at any
 * depth), so a page added without a sitemap entry fails here instead of
 * going unlisted, as the pricing, contact, use-case, download and blog pages
 * once did. Anything under a dynamic segment and the docs are left out of
 * that walk: the sitemap lists the docs and the blog posts page by page from
 * their sources.
 */
import { describe, expect, it, vi } from "vitest";
import { SITE_CONFIG } from "@/lib/constants";
import { staticRoutes } from "@/__test-utils__/static-routes";
import sitemap from "../sitemap";

vi.mock("@/lib/source", () => ({
  source: { getPages: () => [{ url: "/docs/getting-started/quickstart" }] },
  blog: { getPages: () => [{ url: "/blog/a-post" }] },
}));

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

  it("lists every blog post from the blog source", () => {
    expect(sitemap().map((entry) => entry.url)).toContain(`${SITE_CONFIG.url}/blog/a-post`);
  });
});
