// Vitest configuration for the harness's PURE unit arms: the inventory
// library and the cloud-capability fixtures.
//
// Deliberately separate from the suite configs: those boot a target in
// globalSetup (the TS server build, or the hermetic cloud environment), and
// these arms are pure — parsing a YAML, scanning sources, driving an in-process
// fake over loopback. Running them under a target config would spend a server
// build on a millisecond test.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/inventory/**/*.test.ts", "src/harness/__tests__/**/*.test.ts"],
  },
});
