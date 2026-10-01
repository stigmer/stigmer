import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The site's tsconfig uses `jsx: preserve` (Next handles JSX), so tell esbuild
  // to use the automatic runtime for tests — no explicit React import needed.
  esbuild: { jsx: "automatic" },
  test: {
    // Measured only when a run asks for it (`--coverage.enabled`), so a
    // local run stays as fast as without it. Every source file under
    // `include` counts, a file no test loads at 0%; AST-aware remapping
    // names exactly the executable lines a run missed.
    coverage: {
      provider: "v8",
      include: ["src/**", "scripts/**"],
      exclude: [...coverageConfigDefaults.exclude, "**/__test-utils__/**", "**/__fixtures__/**", "**/__mocks__/**"],
      reporter: ["json", "json-summary"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
    environment: "happy-dom",
    server: {
      deps: {
        // fumadocs-ui components import their own .css; Node's ESM loader
        // (which vitest uses for externalized deps) cannot load CSS, so let
        // Vite transform the package instead. Needed by the <Still> tests,
        // which render the real ImageZoom. The .css alias below then keeps
        // those imports out of PostCSS entirely.
        inline: ["fumadocs-ui"],
      },
    },
    // Don't actually fetch iframe `src`es over the network during tests.
    environmentOptions: {
      happyDOM: { settings: { disableIframePageLoading: true } },
    },
  },
  resolve: {
    alias: [
      // Stylesheets are inert in tests — see src/test/css-stub.ts. The
      // pattern spans the whole specifier: Vite replaces only the matched
      // portion, so a bare /\.css$/ would mangle the path instead.
      { find: /^.+\.css$/, replacement: new URL("./src/test/css-stub.ts", import.meta.url).pathname },
      { find: "@/", replacement: new URL("./src/", import.meta.url).pathname },
    ],
  },
});
