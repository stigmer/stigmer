// The gallery page's build. The kit and its workspace siblings are read from
// their sources, as the desktop app reads them, so the page draws exactly
// the code in this tree; `npm run gallery` serves it for browsing, and the
// visual suite serves the production build (playwright.config.ts).
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  optimizeDeps: {
    exclude: ["@stigmer/react-sdk", "@stigmer/client", "@stigmer/apis", "@stigmer/design-tokens"],
  },
  build: {
    outDir: "dist",
    // The page is a test fixture: one predictable file set, read by a browser
    // on this machine, never shipped.
    chunkSizeWarningLimit: 10_000,
  },
});
