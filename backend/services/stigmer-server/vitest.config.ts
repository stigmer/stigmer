import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.test.ts"],
    // The load class (`*.load.test.ts`) runs on its own cadence, by hand,
    // through vitest.load.config.ts (`npm run test:load`): never a variable a
    // default run could flip.
    exclude: [...configDefaults.exclude, "**/*.load.test.ts"],
    // Transport tests bind real sockets; a generous-but-bounded timeout keeps
    // a hung listen/connect from stalling the suite instead of failing it.
    testTimeout: 15_000,
  },
});
