// Vitest configuration for the harness's PURE unit arms: the inventory
// library, the cloud-capability fixtures, the child-process discipline, the
// deviation registry's helpers, the submit-approval seam and the targets'
// implementation declaration.
//
// Deliberately separate from the suite configs: those boot a target in
// globalSetup (the TS server build, or the hermetic cloud environment), and
// these arms are pure — parsing a YAML, scanning sources, driving an in-process
// fake over loopback, a stub reader. Running them under a target config would
// spend a server build on a millisecond test. The suite configs include only
// `src/suites*/**`, so nothing here is ever collected twice.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/inventory/**/*.test.ts",
      "src/harness/__tests__/**/*.test.ts",
      "src/contract/__tests__/**/*.test.ts",
      "src/support/__tests__/**/*.test.ts",
      "src/targets/__tests__/**/*.test.ts",
    ],
  },
});
