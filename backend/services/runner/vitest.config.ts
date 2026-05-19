import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    resolve: {
      conditions: ["import", "node"],
    },
  },
  resolve: {
    alias: [
      {
        find: /^(@stigmer\/protos\/.*)\.js$/,
        replacement: "$1",
      },
      {
        find: /^(\..*)\.js$/,
        replacement: "$1",
      },
    ],
  },
});
