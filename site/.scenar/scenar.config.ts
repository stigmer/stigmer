import { defineConfig } from "@scenar/preview";

export default defineConfig({
  source: "/Users/suresh/scm/github.com/stigmer/stigmer/client-apps/web",
  sourceRoots: ["src"],
  exclude: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*.stories.*",
    "**/node_modules/**",
    "**/dist/**",
    "**/build/**",
    "**/.next/**",
    "**/__tests__/**",
    "**/__mocks__/**",
  ],
  framework: "nextjs",
  entryPoint: "src/app/layout.tsx",
});
