// Vitest configuration for the inventory library's unit arms.
//
// Deliberately separate from the suite configs: those boot a target in
// globalSetup (the TS server build, or the hermetic cloud environment), and
// the inventory logic is pure — parsing a YAML and scanning sources. Running
// it under a target config would spend a server build on a millisecond test.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/inventory/**/*.test.ts"],
  },
});
