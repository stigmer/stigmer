/**
 * One page's metadata, whole: its title and description for search results,
 * and the preview (Open Graph and X) a shared link shows.
 *
 * Next.js replaces a page's `openGraph` and `twitter` objects whole instead
 * of merging them into the root layout's. A page that set only a preview
 * title previewed with no image, address or type, and X showed the
 * homepage's title for it; a page that set none previewed as the homepage.
 * Every route builds its metadata here, so each preview is complete: the
 * page's own address and words, and the site's one image.
 */
import type { Metadata } from "next";
import { SITE_CONFIG } from "@/lib/constants";

/** The site's one preview image, served from `public/`. */
export const SITE_OG_IMAGE = {
  url: "/og-image.png",
  width: 1200,
  height: 630,
  alt: `${SITE_CONFIG.name} — ${SITE_CONFIG.headline}`,
} as const;

export interface PageMetadataInput {
  title: string;
  description?: string;
  /** The page's path below the site's address, e.g. "/pricing". */
  path: string;
  /** The preview's own words, where they differ from the title and description. */
  preview?: { title?: string; description?: string };
  /** Present for a blog post, which previews as an article. */
  article?: { publishedTime: string | Date };
}

export function pageMetadata({
  title,
  description,
  path,
  preview,
  article,
}: PageMetadataInput): Metadata {
  const previewTitle = preview?.title ?? `${title} | ${SITE_CONFIG.name}`;
  const previewDescription = preview?.description ?? description;
  const openGraph = {
    locale: "en_US",
    siteName: SITE_CONFIG.name,
    url: `${SITE_CONFIG.url}${path}`,
    title: previewTitle,
    description: previewDescription,
    images: [SITE_OG_IMAGE],
  };

  return {
    title,
    description,
    openGraph: article
      ? {
          type: "article",
          ...openGraph,
          publishedTime: new Date(article.publishedTime).toISOString(),
        }
      : { type: "website", ...openGraph },
    twitter: {
      card: "summary_large_image",
      title: previewTitle,
      description: previewDescription,
      images: [SITE_OG_IMAGE.url],
    },
  };
}
