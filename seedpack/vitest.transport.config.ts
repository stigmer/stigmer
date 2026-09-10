// Vitest configuration for the seedpack's TRANSPORT probes: live HTTP against
// every vendor endpoint the marketplace catalog declares. Network required,
// credential-free; the tier between the static suites and the credentialed
// canaries. Run by `make test-seedpack-transport`, which the nightly
// ci.seedpack-canary lane invokes.
//
// This is the only config whose include reaches src/__tests__/transport/, so
// the probes never run under the static config (vitest.config.ts excludes
// the directory). The JUnit file is what the lane's test-reporter step
// publishes; the directory is covered by the root `.test-output*/` ignore.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/transport/**/*.test.ts"],
    reporters: ["default", "junit"],
    outputFile: { junit: ".test-output-transport/junit.xml" },
    // A probe's own budget is 10 s (the Go client timeout); the test budget
    // covers the slowest vendor plus the skip decision on a transient error.
    testTimeout: 30_000,
  },
});
