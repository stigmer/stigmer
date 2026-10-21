import type { MetadataRoute } from "next";
import { SITE_CONFIG } from "@/lib/constants";

// Required for static export
export const dynamic = "force-static";

/** The web manifest, served at /manifest.webmanifest; Next links it from every page. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_CONFIG.name,
    short_name: SITE_CONFIG.name,
    description: SITE_CONFIG.description,
    start_url: "/",
    display: "standalone",
    // Dark-only site: the same color as the layout's themeColor.
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    // The mark on its rounded tile (scripts/generate-images.ts), shown as is.
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    ],
  };
}
