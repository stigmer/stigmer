import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // Transport tests bind real sockets; a generous-but-bounded timeout keeps
    // a hung listen/connect from stalling the suite instead of failing it.
    testTimeout: 15_000,
  },
});
