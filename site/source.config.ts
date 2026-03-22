import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "../docs",
  docs: {
    files: ["**/*.mdx", "!_archive/**"],
  },
  meta: {
    files: ["**/meta.json", "!_archive/**"],
  },
});

export default defineConfig();
