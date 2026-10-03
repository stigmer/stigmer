import { configDefaults, coverageConfigDefaults, defineConfig } from "vitest/config";

// GitHub Actions (and other CI) sets CI=true. See the poolOptions note below.
const ci = !!process.env.CI;

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
        "src/workflows/call-agent-orchestrator.ts",
        "src/workflows/human-input-orchestrator.ts",
        "src/workflows/listen-orchestrator.ts",
        "src/workflows/run-orchestrator.ts",
      ],
      reporter: ["json", "json-summary"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    // The live class (`*.live.test.ts`) calls real providers with real keys
    // and spends money, so it runs only through vitest.live.config.ts
    // (`npm run test:live`), by hand or in the live lane: never a variable a
    // default run could flip.
    exclude: [...configDefaults.exclude, "**/*.live.test.ts"],
    // Fail fast (before collection) on a Node that cannot run the runner —
    // without this, the sqlite-importing files die mid-collection with a raw
    // ERR_UNKNOWN_BUILTIN_MODULE (oss#257). See the setup file's header.
    globalSetup: ["./src/__test-utils__/vitest-global-setup.ts"],
    // Several suites drive REAL bash/git subprocesses (the approval hook, the git
    // snapshot/restore capture). Under full file-parallelism these legitimately
    // exceed the 5s default when the CPU is saturated, so give subprocess tests
    // headroom rather than letting load cause false timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // In CI, cap the fork pool. Vitest's default `forks` pool spawns ~numCPU
    // worker processes; because so many of our tests fork their own bash/git
    // children, an unbounded pool oversubscribes a constrained CI runner and
    // starves vitest's main-thread reporter RPC — surfacing as spurious
    // `onTaskUpdate` timeouts rather than real test failures. A small cap trades
    // a little wall-clock for determinism. Local runs (no CI env) keep full
    // parallelism; `CI=1 npm test` reproduces the CI behavior exactly.
    ...(ci ? { poolOptions: { forks: { maxForks: 2 } } } : {}),
    resolve: {
      conditions: ["import", "node"],
    },
  },
  resolve: {
    alias: [
      {
        find: /^(@stigmer\/protos\/.*)\.js$/,
        replacement: "$1",
      },
      {
        find: /^(\..*)\.js$/,
        replacement: "$1",
      },
    ],
  },
});
