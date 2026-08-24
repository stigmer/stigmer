import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/**/*.test.ts"],
  },
  resolve: {
    alias: [
      // Source imports carry NodeNext-style `.js` extensions; strip them so
      // vitest resolves the sibling `.ts` sources directly (same alias the
      // runner's and temporal-codecs' vitest configs use).
      {
        find: /^(\..*)\.js$/,
        replacement: "$1",
      },
    ],
  },
});
