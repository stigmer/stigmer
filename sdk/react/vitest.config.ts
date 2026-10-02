import { coverageConfigDefaults, defineConfig } from "vitest/config";

/**
 * The default (happy-dom) suite runs on vitest's `vmForks` pool, apart from
 * the files in `FORKS_ONLY` below and a coverage run (`COVERAGE_RUN`).
 *
 * Why the pool matters: under the default `forks` pool every test file starts
 * a new child process and re-imports happy-dom before its first test, and on
 * the 4-vCPU CI runner that per-file setup cost more than the tests
 * themselves. `vmForks` keeps each worker process alive and gives every file a
 * fresh happy-dom `Window` as its VM context, with its own module evaluation,
 * so globals and module-level state (the reduced-motion media query, the
 * shortcut registry's platform check) still start clean in every file.
 * Measured on ubuntu-latest, 2026-09-29 (stigmer/stigmer#1060): `forks`
 * 230.8 / 270.9 / 272.6 / 273.6 / 293.0 s, `vmForks` 91.7 / 144.7 / 147.2 s.
 * A coverage diff of the whole suite under both pools covered the same
 * statements and functions in every source file. Also measured and left out:
 * `maxWorkers: "100%"` (267.8 / 271.4 s; the runner is already saturated at
 * three workers plus the main process), `pool: "threads"` and
 * `deps.optimizer.web` (inside the run-to-run noise).
 *
 * The cost of a VM context is a second realm: objects that happy-dom creates
 * belong to the outer realm, values a test creates belong to the file's
 * context, and a check like `instanceof ArrayBuffer` can fail across the two.
 */
const FORKS_ONLY = [
  // Compile the SDK stylesheet through @tailwindcss/node, which installs a
  // Node module loader hook (`module.register`); vm pools do not provide it.
  "src/__tests__/styles-border-layer-invariant.test.ts",
  "src/__tests__/styles-dist-isolation.test.ts",
  // Hands an ArrayBuffer built in the file's context to happy-dom's
  // `Response`, which does not recognise it across realms, so the zip arrives
  // empty. A browser has one realm, and so does `forks`.
  "src/skill/__tests__/fetchAndUnpackArtifact.test.ts",
];
// A file that fails only under vmForks joins FORKS_ONLY with its reason; its
// test body is not bent to fit the pool.

/**
 * A coverage run (`--coverage.enabled`, as the CI lanes pass it) puts every
 * file on `forks`. Under `vmForks` each file evaluates its whole module graph
 * again in its own context, and gathering V8's coverage of all those scripts
 * outgrew every worker's ~4 GB heap at once on the 4-vCPU CI runner
 * (2026-10-01: 497 of 499 files passed, then all three workers died, with or
 * without recycling them at 2 GB). `forks` gathers each file's coverage on its
 * own and covers the same statements (the diff above), at the `forks` time.
 * CI runs the suite both ways, so the pool developers run is still checked
 * (ci.ts-workspace.yaml, `react-tests` and `react-vm-tests`).
 * The flags are the CLI spellings vitest 3.2 reads as coverage on; it reads
 * `--coverage.enabled true` as a file filter, with coverage left off.
 */
const COVERAGE_FLAGS = new Set(["--coverage", "--coverage=true", "--coverage.enabled", "--coverage.enabled=true"]);
const COVERAGE_RUN = process.argv.some((arg) => COVERAGE_FLAGS.has(arg));

export default defineConfig({
  test: {
    // Measured only when a run asks for it (`--coverage.enabled`), so a
    // local run stays as fast as without it. Every source file under
    // `include` counts, a file no test loads at 0%; AST-aware remapping
    // names exactly the executable lines a run missed.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [...coverageConfigDefaults.exclude, "**/__test-utils__/**", "**/__fixtures__/**", "**/__mocks__/**"],
      reporter: ["json", "json-summary"],
      reportOnFailure: true,
      experimentalAstAwareRemapping: true,
    },
    // The `*.browser.test.ts(x)` suites (accessibility audits, layout
    // contracts, pixel APIs — canvas 2D, createImageBitmap — that happy-dom
    // cannot evaluate) run in a real browser via `vitest.a11y.config.ts`.
    // Exclude them here so the fast, browser-free default suite never tries
    // to load them.
    exclude: [
      "**/node_modules/**",
      "**/*.browser.test.ts",
      "**/*.browser.test.tsx",
    ],
    environment: "happy-dom",
    // Never let happy-dom follow a navigation over the real network. An
    // anchor click with target="_blank" (the browser-download flows) becomes
    // a popup navigation whose request happy-dom issues with its INTERNAL
    // Fetch class — a globalThis.fetch stub cannot intercept it; only these
    // settings block it, before any request is created. Unblocked, the stray
    // DNS lookup resolves after its test has returned and the error lands on
    // an unrelated test (the AgentShareList flake in issue #334).
    environmentOptions: {
      happyDOM: {
        settings: {
          navigation: {
            disableMainFrameNavigation: true,
            disableChildFrameNavigation: true,
            disableChildPageNavigation: true,
          },
        },
      },
    },
    // Raises testing-library's suite-wide async timeout (portaled Base UI
    // content mounts asynchronously and flakes under CI load at the 1s
    // default); see the rationale in the setup file.
    setupFiles: ["./vitest.setup.ts"],
    // Headroom above the 4s async-util timeout so a failing wait reports
    // the informative testing-library error (element query + DOM dump)
    // instead of tripping vitest's own 5s default first.
    testTimeout: 15000,
    // One suite, two pools. Each project inherits everything above; the
    // `exclude` a project adds is appended to the shared list.
    projects: [
      {
        extends: true,
        test: {
          name: "vm",
          include: ["src/**/*.test.{ts,tsx}"],
          exclude: FORKS_ONLY,
          pool: COVERAGE_RUN ? "forks" : "vmForks",
        },
      },
      {
        extends: true,
        test: {
          name: "forks",
          include: FORKS_ONLY,
          pool: "forks",
        },
      },
    ],
  },
});
