import { defineConfig } from "vitest/config";

import base from "./vitest.config";

/**
 * The live class (`npm run test:live`): only `*.live.test.ts`, one file at a
 * time. These files call real model providers with real keys, so they spend
 * real money and depend on a provider being up; they run by hand and in the
 * live lane after a release, never in `npm test` (vitest.config.ts excludes
 * them). Each suite skips without its key outside the lane and fails without
 * it inside (`src/__test-utils__/live-gate.ts`).
 *
 * Sequential, because a live turn is slow and costs money, and two at once
 * would only make a provider's rate limit part of the result. No retries:
 * a real model that misbehaves is a red the reader judges, never a re-roll.
 * The module resolution is the default config's, read from it, so a live file
 * imports the runner exactly as its unit tests do.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.live.test.ts"],
    globalSetup: base.test?.globalSetup,
    fileParallelism: false,
    testTimeout: 5 * 60_000,
    hookTimeout: 60_000,
    resolve: base.test?.resolve,
  },
  resolve: base.resolve,
});
