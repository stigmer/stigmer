import {
  defineDocs,
  defineCollections,
  defineConfig,
  frontmatterSchema,
} from "fumadocs-mdx/config";
import { z } from "zod";
import remarkMermaid from "./src/lib/remark-mermaid";

export const docs = defineDocs({
  dir: "../docs",
  docs: {
    files: ["**/*.mdx", "!_archive/**"],
    schema: frontmatterSchema.extend({
      // Landing pages set `hero: true` to render their own header (a <Hero>
      // in the MDX body) instead of the default DocsTitle/DocsDescription row
      // — same per-page layout-control idiom as Fumadocs' built-in `full`.
      // Consumed in app/docs/[[...slug]]/page.tsx.
      hero: z.boolean().optional(),
    }),
  },
  meta: {
    files: ["**/meta.json", "!_archive/**"],
  },
});

export const blogPosts = defineCollections({
  type: "doc",
  dir: "../blog",
  schema: frontmatterSchema.extend({
    author: z.string().optional(),
    date: z.string().date().or(z.date()),
    github: z.string().optional(),
  }),
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [remarkMermaid, ...plugins],
  },
});
