/**
 * One page's metadata, whole: what search results and a shared link's
 * preview say about that page.
 *
 * Next.js replaces a page's `openGraph` and `twitter` objects whole instead
 * of merging them into the root layout's, so a page whose preview lacks a
 * field previews without it. Pins that the helper returns every field a
 * preview reads (the page's own address, title, description, type and the
 * site's image) for a page and for a blog post.
 */
import { describe, expect, it } from "vitest";
import { SITE_CONFIG } from "@/lib/constants";
import { SITE_OG_IMAGE, pageMetadata } from "../page-metadata";

describe("pageMetadata", () => {
  it("gives a page its own address and the site's image in every preview", () => {
    expect(
      pageMetadata({ title: "Pricing", description: "What it costs.", path: "/pricing" }),
    ).toEqual({
      title: "Pricing",
      description: "What it costs.",
      openGraph: {
        type: "website",
        locale: "en_US",
        siteName: SITE_CONFIG.name,
        url: `${SITE_CONFIG.url}/pricing`,
        title: `Pricing | ${SITE_CONFIG.name}`,
        description: "What it costs.",
        images: [SITE_OG_IMAGE],
      },
      twitter: {
        card: "summary_large_image",
        title: `Pricing | ${SITE_CONFIG.name}`,
        description: "What it costs.",
        images: [SITE_OG_IMAGE.url],
      },
    });
  });

  it("uses a page's own preview words where they differ from its title and description", () => {
    const metadata = pageMetadata({
      title: "Download",
      description: "The long description.",
      path: "/download",
      preview: { title: "Download Stigmer Desktop | Stigmer", description: "The short one." },
    });

    expect(metadata.title).toBe("Download");
    expect(metadata.description).toBe("The long description.");
    expect(metadata.openGraph).toMatchObject({
      title: "Download Stigmer Desktop | Stigmer",
      description: "The short one.",
    });
    expect(metadata.twitter).toMatchObject({
      title: "Download Stigmer Desktop | Stigmer",
      description: "The short one.",
    });
  });

  it("previews a blog post as an article with its publication date", () => {
    const metadata = pageMetadata({
      title: "A post",
      description: "What it says.",
      path: "/blog/a-post",
      article: { publishedTime: new Date("2026-10-22") },
    });

    expect(metadata.openGraph).toMatchObject({
      type: "article",
      url: `${SITE_CONFIG.url}/blog/a-post`,
      publishedTime: "2026-10-22T00:00:00.000Z",
      images: [SITE_OG_IMAGE],
    });
    expect(
      pageMetadata({
        title: "A post",
        description: "What it says.",
        path: "/blog/a-post",
        article: { publishedTime: "2026-10-22" },
      }).openGraph,
    ).toMatchObject({ publishedTime: "2026-10-22T00:00:00.000Z" });
  });

  it("names the site's one preview image at its full size", () => {
    expect(SITE_OG_IMAGE).toEqual({
      url: "/og-image.png",
      width: 1200,
      height: 630,
      alt: `${SITE_CONFIG.name} — ${SITE_CONFIG.headline}`,
    });
  });
});
