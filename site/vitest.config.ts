import { defineConfig } from "vitest/config";

export default defineConfig({
  // The site's tsconfig uses `jsx: preserve` (Next handles JSX), so tell esbuild
  // to use the automatic runtime for tests — no explicit React import needed.
  esbuild: { jsx: "automatic" },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
    // Don't actually fetch iframe `src`es over the network during tests.
    environmentOptions: {
      happyDOM: { settings: { disableIframePageLoading: true } },
    },
  },
  resolve: {
    alias: {
      "@/": new URL("./src/", import.meta.url).pathname,
    },
  },
});
