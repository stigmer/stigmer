// The coding-agent plugin's suite: the built plugin read by Stigmer's own
// plugin reader, every manifest and marketplace file, and the guide. Coverage
// is measured only when a run asks for it (`--coverage.enabled`), over the
// build script, as the gate's Coverage job reads it.
import { coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["scripts/**"],
      exclude: [...coverageConfigDefaults.exclude],
      reporter: ["json", "json-summary"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
    include: ["__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
