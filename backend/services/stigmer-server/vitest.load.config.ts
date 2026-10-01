import { defineConfig } from "vitest/config";

/**
 * The load class (`npm run test:load`): only `*.load.test.ts`, one file at a
 * time. These files measure what a read costs at production's shape on
 * Postgres and record the numbers rather than assert them, so they run by
 * hand beside the change that moves them, never in `npm test`. Sequential,
 * because two measurements on one machine would measure each other.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.load.test.ts"],
    fileParallelism: false,
    testTimeout: 10 * 60_000,
    hookTimeout: 10 * 60_000,
  },
});
