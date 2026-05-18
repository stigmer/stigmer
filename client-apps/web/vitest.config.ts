import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "happy-dom",
  },
  resolve: {
    alias: {
      "@/": new URL("./src/", import.meta.url).pathname,
    },
  },
});
