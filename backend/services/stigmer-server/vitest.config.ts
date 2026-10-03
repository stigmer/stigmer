import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Measured only when a run asks for it (`--coverage.enabled`), so a
    // local run stays as fast as without it. Every source file under
    // `include` counts, a file no test loads at 0%; AST-aware remapping
    // names exactly the executable lines a run missed.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        ...coverageConfigDefaults.exclude,
        "**/__test-utils__/**",
        "**/__fixtures__/**",
        "**/__mocks__/**",
        // Workflow modules whose functions run only inside the Temporal
        // workflow sandbox: the suites reach them through the worker's bundle,
        // which V8 coverage never maps back to these files, so their bodies
        // would read as unrun and refuse every edit made inside them. The list
        // names files, not a rule: a module whose functions a test calls
        // in-process comes off the list, so it is measured again.
        "src/temporal/agentexecution/workflows/invoke-agent-execution.ts",
        "src/temporal/workflowexecution/workflows/invoke-workflow-execution.ts",
      ],
      reporter: ["json", "json-summary"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
    include: ["src/**/__tests__/**/*.test.ts"],
    // The load class (`*.load.test.ts`) runs on its own cadence, by hand,
    // through vitest.load.config.ts (`npm run test:load`): never a variable a
    // default run could flip.
    exclude: [...configDefaults.exclude, "**/*.load.test.ts"],
    // Transport tests bind real sockets; a generous-but-bounded timeout keeps
    // a hung listen/connect from stalling the suite instead of failing it.
    testTimeout: 15_000,
  },
});
