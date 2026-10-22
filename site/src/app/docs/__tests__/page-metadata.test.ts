/**
 * A docs page's metadata: what search results and a shared link's preview
 * say about the page.
 *
 * Pins that a docs page previews at its own address, with its own title and
 * the site's image, and not as the homepage, which every docs page once did.
 */
import { describe, expect, it, vi } from "vitest";
import { SITE_CONFIG } from "@/lib/constants";
import { SITE_OG_IMAGE } from "@/lib/page-metadata";

vi.mock("@/lib/source", () => ({
  source: {
    getPage: (slug: string[] | undefined) =>
      slug?.join("/") === "getting-started/quickstart"
        ? {
            url: "/docs/getting-started/quickstart",
            data: { title: "Quickstart", description: "The first job." },
          }
        : undefined,
  },
}));

const { generateMetadata } = await import("../[[...slug]]/page");

describe("a docs page's metadata", () => {
  it("previews the page at its own address", async () => {
    const metadata = await generateMetadata({
      params: Promise.resolve({ slug: ["getting-started", "quickstart"] }),
    });

    expect(metadata.title).toBe("Quickstart");
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: `${SITE_CONFIG.url}/docs/getting-started/quickstart`,
      title: `Quickstart | ${SITE_CONFIG.name}`,
      description: "The first job.",
      images: [SITE_OG_IMAGE],
    });
    expect(metadata.twitter).toMatchObject({
      title: `Quickstart | ${SITE_CONFIG.name}`,
      images: [SITE_OG_IMAGE.url],
    });
  });
});
