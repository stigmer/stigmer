import { defineDocs, defineConfig } from "fumadocs-mdx/config";

export const docs = defineDocs({
  dir: "../docs",
  docs: {
    files: ["**/*.mdx", "!standards/**"],
  },
  meta: {
    files: ["**/meta.json", "!standards/**"],
  },
});

export default defineConfig();
