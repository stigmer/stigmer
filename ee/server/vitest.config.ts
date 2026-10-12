import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

/**
 * The package's suite (`npm test`). Every test under `src/` runs except the
 * load class (`*.load.test.ts`), which drives an engine for minutes and is
 * run by hand; a suite that needs Postgres reads `TEST_DATABASE_URL` and skips by name without
 * it, unless `STIGMER_TEST_GATE=1` makes a missing database a failure.
 *
 * The hook budget. Every composed suite boots a server in its `beforeAll`
 * (a database, `composeServer`, `start()`), and on a loaded machine a
 * passing boot has taken close to vitest's 10 s default. 60 s leaves room
 * for that without hiding a hook that hangs: it still fails, only later. A
 * hook that sets its own timeout keeps it.
 *
 * Coverage. It is measured only when a run asks for it (`--coverage.enabled`),
 * so a local run stays as fast as without it. Every source file under `src/`
 * counts, and a file no test loads counts at 0%. AST-aware remapping names
 * exactly the executable lines a run missed. The block is the one
 * `@stigmer/server` measures itself with.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [...configDefaults.exclude, "**/*.load.test.ts"],
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [...coverageConfigDefaults.exclude, "**/__test-utils__/**", "**/__fixtures__/**", "**/__mocks__/**"],
      reporter: ["json", "json-summary"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
  },
});
