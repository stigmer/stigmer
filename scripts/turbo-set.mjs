#!/usr/bin/env node

/**
 * Runs one Turborepo task over a named set of workspace packages.
 *
 * The root package.json scripts (`build:libs`, `clean:libs`, `test`,
 * `build:runner-deps`) each mean "this task, over this set of packages". The
 * sets already have a home; this script reads them from it instead of
 * repeating eleven `--filter` flags per script:
 *
 *   libs         the publishable @stigmer/* packages, in publish order:
 *                `PACKAGES` in scripts/publish-libs.mjs (the same import
 *                scripts/verify-esm-node.mjs uses "so the two never drift").
 *   runner-deps  the workspace libs the standalone runner and stigmer-server
 *                link with `file:` (their own package.json is the truth; the
 *                comment in ci.ts-libs.yaml used to ask humans to keep a copy
 *                in step by hand).
 *
 * Task edges, outputs and cache inputs live in turbo.json; this script only
 * chooses the packages and the flags that belong to a set:
 *
 *   - `libs test` runs with --concurrency=1. The ten suites already fan out
 *     across cores inside vitest, and the react suite raised its timeouts for
 *     CI load once (sdk/react/vitest.config.ts); running ten vitest processes
 *     at once on a 4-core runner would trade wall time for flakes. Serial is
 *     today's behavior; raising it is a measurement for the CI stage.
 *   - Telemetry is off (owner ruling D3, 2026-09-10): Turborepo reports
 *     anonymous usage to Vercel by default from every machine and runner, and
 *     the only switches are per machine or this variable. Setting it here
 *     covers CI, developers and the Windows runner in one place.
 *
 * Turbo is started through its JavaScript entry with the current Node binary
 * rather than the `.bin` shim: on Windows that shim is a `.cmd` file Node
 * refuses to spawn without a shell (the same reason
 * sdk/react/scripts/build-styles.ts invokes the Tailwind CLI that way).
 *
 * Usage:
 *   node scripts/turbo-set.mjs <set> <task> [turbo flags...]
 *   node scripts/turbo-set.mjs libs build
 *   node scripts/turbo-set.mjs libs build --force        # bypass the cache
 *   node scripts/turbo-set.mjs runner-deps build
 *
 * Every extra argument is handed to `turbo run` unchanged, so
 * `npm run build:libs -- --dry-run` works.
 */

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PACKAGES } from "./publish-libs.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The standalone packages whose `file:` links define the runner-deps set.
 * Both link the same libs today; the union is taken so a lib either one adds
 * is built for both.
 */
export const RUNNER_LINKED_MANIFESTS = [
  "backend/services/runner/package.json",
  "backend/services/stigmer-server/package.json",
];

function readManifest(rootDir, relPath) {
  return JSON.parse(readFileSync(join(rootDir, relPath), "utf8"));
}

/** Package names of `PACKAGES`, in publish order. */
export function libsSet(rootDir = root) {
  return PACKAGES.map(
    (relDir) => readManifest(rootDir, join(relDir, "package.json")).name,
  );
}

/**
 * Every `@stigmer/*` dependency the runner-linked manifests declare with a
 * `file:` specifier, deduplicated and sorted. Only `dependencies` is read:
 * the release workflows rewrite exactly those links to the published
 * version, so they are the libs a runner build must have on disk.
 */
export function runnerLinkedSet(
  rootDir = root,
  manifests = RUNNER_LINKED_MANIFESTS,
) {
  const names = new Set();
  for (const relPath of manifests) {
    const { dependencies = {} } = readManifest(rootDir, relPath);
    for (const [name, spec] of Object.entries(dependencies)) {
      if (name.startsWith("@stigmer/") && spec.startsWith("file:")) {
        names.add(name);
      }
    }
  }
  return [...names].sort();
}

export const SETS = {
  libs: libsSet,
  "runner-deps": runnerLinkedSet,
};

/** Resolve a set name to package names, or throw with the valid names. */
export function resolveSet(set, rootDir = root) {
  const resolver = SETS[set];
  if (!resolver) {
    throw new Error(
      `turbo-set: unknown set "${set}". Known sets: ${Object.keys(SETS).join(", ")}.`,
    );
  }
  return resolver(rootDir);
}

/**
 * The argument list for `turbo run`: the task, one --filter per package in
 * the set, the set's own flags, then whatever the caller appended.
 */
export function turboArgs(set, task, extra = [], rootDir = root) {
  if (!task || task.startsWith("-")) {
    throw new Error(
      "turbo-set: usage: turbo-set.mjs <set> <task> [turbo flags...]",
    );
  }
  const args = [
    "run",
    task,
    ...resolveSet(set, rootDir).map((name) => `--filter=${name}`),
  ];
  if (set === "libs" && task === "test") {
    args.push("--concurrency=1");
  }
  return [...args, ...extra];
}

/** The environment turbo runs with: the caller's, plus telemetry off (D3). */
export function turboEnv(env = process.env) {
  return { ...env, TURBO_TELEMETRY_DISABLED: "1" };
}

/** Turbo's JavaScript entry (bin/turbo), resolved from this repo's install. */
export function turboBin() {
  const require = createRequire(import.meta.url);
  return require.resolve("turbo/bin/turbo");
}

/**
 * Spawn turbo synchronously and return the spawnSync result. `stdio` defaults
 * to inherit (the interactive shape); the graph tests pass "pipe" to read a
 * dry run.
 */
export function runTurbo(
  args,
  { cwd = root, stdio = "inherit", env = process.env } = {},
) {
  return spawnSync(process.execPath, [turboBin(), ...args], {
    cwd,
    stdio,
    env: turboEnv(env),
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * `turbo run <tasks...> --dry-run=json` over a set, parsed. What the graph
 * tests read: each task's `dependencies` (the edges turbo resolved) and
 * `inputs` (the files it hashes).
 */
export function dryRun(set, tasks, rootDir = root) {
  const filters = resolveSet(set, rootDir).map((name) => `--filter=${name}`);
  const result = runTurbo(["run", ...tasks, ...filters, "--dry-run=json"], {
    cwd: rootDir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `turbo-set: dry run failed (exit ${result.status}):\n${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout.toString("utf8"));
}

function main(argv) {
  const [set, task, ...extra] = argv;
  if (!set) {
    console.error(
      "turbo-set: usage: turbo-set.mjs <set> <task> [turbo flags...]",
    );
    console.error(`  sets: ${Object.keys(SETS).join(", ")}`);
    return 2;
  }
  let args;
  try {
    args = turboArgs(set, task, extra);
  } catch (error) {
    console.error(error.message);
    return 2;
  }
  console.log(`  $ turbo ${args.join(" ")}`);
  const result = runTurbo(args);
  if (result.error) {
    console.error(`turbo-set: could not start turbo: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exit(main(process.argv.slice(2)));
}
