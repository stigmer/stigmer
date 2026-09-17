// The catalogue's static suite: deterministic and network-free, over the
// files in this directory. What `make test-plugins-static` runs on every
// plugins/** change.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
