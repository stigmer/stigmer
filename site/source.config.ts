import { defineDocs, defineConfig } from "fumadocs-mdx/config";
import remarkMermaid from "./src/lib/remark-mermaid";

export const docs = defineDocs({
  dir: "../docs",
  docs: {
    files: ["**/*.mdx", "!_archive/**"],
  },
  meta: {
    files: ["**/meta.json", "!_archive/**"],
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: (plugins) => [remarkMermaid, ...plugins],
  },
});
