import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: [
      // cursor-runner source uses `.js` extensions (Node ESM convention).
      // The protos package exports `.ts` files. Strip the `.js` suffix so
      // Vite can resolve `@stigmer/protos/…/enum_pb.js` → `…/enum_pb.ts`.
      { find: /^(@stigmer\/protos\/.*)\.js$/, replacement: "$1" },
      // Same for internal `.js` imports across source modules.
      { find: /^(\.\.?\/.*)\.js$/, replacement: "$1" },
    ],
  },
});
