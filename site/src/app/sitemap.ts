import type { MetadataRoute } from "next";
import { blog, source } from "@/lib/source";
import { SITE_CONFIG } from "@/lib/constants";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_CONFIG.url;
  const now = new Date();

  const routes: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/llms.txt`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // Every static page outside the docs; a test fails when a new one is missing here.
  for (const path of [
    "/pricing",
    "/contact-sales",
    "/compare/claude-managed-agents",
    "/about",
    "/download",
    "/blog",
  ]) {
    routes.push({
      url: `${baseUrl}${path}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    });
  }

  for (const page of source.getPages()) {
    routes.push({
      url: `${baseUrl}${page.url}`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  for (const page of blog.getPages()) {
    routes.push({
      url: `${baseUrl}${page.url}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return routes;
}
