import { defineConfig } from "vitest/config";

/**
 * The live class (`npm run test:live`): only `*.live.test.ts`, one file at a
 * time. These files drive a real system outside the test process that no
 * gate service provides: today, a sandbox driver against a cluster running
 * the upstream release it is built on. They run through the entry point that
 * makes that system (`make test-agent-sandbox` for the agent-sandbox driver)
 * and in that lane, never in `npm test` (vitest.config.ts excludes them).
 * Each file fails without what it is given, never skips.
 *
 * Sequential, because each file owns a cluster's objects and minutes of wall
 * time. No retries: a real system that misbehaves is a red the reader
 * judges, never a re-roll.
 */
export default defineConfig({
  test: {
    include: ["src/**/__tests__/**/*.live.test.ts"],
    fileParallelism: false,
    testTimeout: 10 * 60_000,
    hookTimeout: 5 * 60_000,
  },
});
