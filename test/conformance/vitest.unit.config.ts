// Vitest configuration for the harness's PURE unit arms: the inventory
// library, the cloud-capability fixtures, the child-process discipline and the
// submit-approval seam.
//
// Deliberately separate from the suite configs: those boot a target in
// globalSetup (the TS server build, or a pre-provisioned cloud environment),
// and these arms are pure — parsing a YAML, scanning sources, driving an
// in-process fake over loopback, a stubbed submit. Running them under a target
// config would spend a server build on a millisecond test. The suite configs
// include only `src/suites*/**`, so nothing here is ever collected twice.
//
// The include list names directories, not files: a `__tests__` folder under
// any of these roots is collected the day it gains a test, with no config edit.
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
