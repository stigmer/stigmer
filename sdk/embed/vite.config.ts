import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Builds the single, self-contained `<script>` artifact `dist/embed.global.js`
 * — the paste-only delivery of the loader. It is an IIFE that auto-registers
 * the `<stigmer-agent>` custom element and derives the Stigmer app origin from
 * its own script URL, so the one-line snippet needs zero configuration.
 *
 * The loader must stay dependency-free (no React, no SDK): the iframe is the
 * runtime boundary, and everything heavy lives on the hosted chat page inside
 * it. A host page pays only for this file (~a few kB).
 *
 * `emptyOutDir: false` is load-bearing: `tsc -p tsconfig.build.json` runs
 * first and emits the ESM entries + declarations into `dist/`; this pass only
 * adds the global and must not wipe them.
 */
export default defineConfig({
  build: {
    emptyOutDir: false,
    minify: true,
    sourcemap: false,
    lib: {
      entry: resolve(here, "src/global.ts"),
      formats: ["iife"],
      name: "StigmerEmbed",
      fileName: () => "embed.global.js",
    },
    rollupOptions: {
      // The global is a standalone <script>: inline everything so no bare
      // import survives into the browser bundle.
      external: () => false,
    },
  },
});
