// The gallery page's build. The kit and its workspace siblings are read from
// their sources, as the desktop app reads them, so the page draws exactly
// the code in this tree; `npm run gallery` serves it for browsing, and the
// visual suite serves the production build (playwright.config.ts).
//
// The build has two readers: the visual suite, served at the root, and the
// docs site, which builds it again under /gallery/ for its live demos
// (site/scripts/generate-gallery.ts passes `--base` and `--outDir`).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  optimizeDeps: {
    exclude: ["@stigmer/react-core", "@stigmer/react-sdk", "@stigmer/client", "@stigmer/apis", "@stigmer/design-tokens"],
  },
  build: {
    outDir: "dist",
    // The page draws the whole kit, so its chunks are large; the docs frame
    // it lazily, and the kit's own bundle budgets hold what an embedder ships.
    chunkSizeWarningLimit: 10_000,
  },
});
