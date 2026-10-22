/**
 * A blog post's metadata: what search results and a shared link's preview
 * say about the post.
 *
 * Pins that a post previews as itself, an article at its own address with
 * its own title, its date and the site's image, and not as the homepage,
 * which a post with only a title and description once did.
 */
import { describe, expect, it, vi } from "vitest";
import { SITE_CONFIG } from "@/lib/constants";
import { SITE_OG_IMAGE } from "@/lib/page-metadata";

vi.mock("@/lib/source", () => ({
  blog: {
    getPage: ([slug]: string[]) =>
      slug === "a-post"
        ? {
            url: "/blog/a-post",
            data: { title: "A post", description: "What it says.", date: new Date("2026-10-22") },
          }
        : undefined,
    getPages: () => [],
  },
}));

const { generateMetadata } = await import("../[slug]/page");

describe("a blog post's metadata", () => {
  it("previews the post as an article at its own address", async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ slug: "a-post" }) });

    expect(metadata.title).toBe("A post");
    expect(metadata.description).toBe("What it says.");
    expect(metadata.openGraph).toMatchObject({
      type: "article",
      url: `${SITE_CONFIG.url}/blog/a-post`,
      title: `A post | ${SITE_CONFIG.name}`,
      description: "What it says.",
      publishedTime: "2026-10-22T00:00:00.000Z",
      images: [SITE_OG_IMAGE],
    });
    expect(metadata.twitter).toMatchObject({
      title: `A post | ${SITE_CONFIG.name}`,
      images: [SITE_OG_IMAGE.url],
    });
  });
});
