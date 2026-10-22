/**
 * Every static page previews as itself when its link is shared.
 *
 * Walks every static route on disk and reads its metadata: the preview must
 * name the page's own address, carry the site's image, and give X the
 * page's own title. Pages once set only a preview title and description, and
 * because Next.js replaces the root's preview objects whole, they previewed
 * with no image or address, and X showed the homepage's title. A page added
 * later is walked too.
 */
import { describe, expect, it, vi } from "vitest";
import * as path from "node:path";
import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";
import { SITE_OG_IMAGE } from "@/lib/page-metadata";
import { APP_DIR, staticRoutes } from "@/__test-utils__/static-routes";

vi.mock("@/lib/source", () => ({
  source: { getPages: () => [] },
  blog: { getPages: () => [] },
}));

const HOMEPAGE_TITLE = `${SITE_CONFIG.name} — ${SITE_CONFIG.headline}`;

/** Every static route with its metadata, loaded once as the file is collected. */
const PAGES = await Promise.all(
  staticRoutes().map(async (route) => {
    const { metadata } = (await import(path.join(APP_DIR, route, "page.tsx"))) as {
      metadata: Metadata;
    };
    return [route, metadata] as const;
  }),
);

describe("link previews", () => {
  it("walks the site's static pages", () => {
    const routes = PAGES.map(([route]) => route);

    expect(routes).toContain("/pricing");
    expect(routes).toContain("/blog");
  });

  it.each(PAGES)("%s previews as itself", (route, metadata) => {
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: `${SITE_CONFIG.url}${route}`,
      siteName: SITE_CONFIG.name,
      images: [SITE_OG_IMAGE],
    });
    expect(metadata.openGraph?.title).not.toBe(HOMEPAGE_TITLE);
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: metadata.openGraph?.title,
      description: metadata.openGraph?.description,
      images: [SITE_OG_IMAGE.url],
    });
  });
});
