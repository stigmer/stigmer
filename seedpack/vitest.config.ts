// Vitest configuration for the seedpack's STATIC suites: the package API
// (content root, hash, extract) and the catalog policies over the shipped
// manifests. Deterministic and network-free; this is what `make
// test-seedpack-static` and the ci.seedpack-static lane run on every
// seedpack/** change.
//
// The transport probes live under src/__tests__/transport/ and are excluded
// here by directory, not by convention: only vitest.transport.config.ts
// includes that path, so a static run cannot reach the network by
// construction (the guarantee the Go `transport` build tag used to give).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/__tests__/**/*.test.ts"],
    exclude: ["src/__tests__/transport/**", "**/node_modules/**", "**/dist/**"],
  },
});
