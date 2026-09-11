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
 *                retired ci.ts-libs lane used to ask humans to keep a copy in
 *                step by hand).
 *   workspace    every member of the root package.json `workspaces` list, in
 *                that order. The CI lane runs `typecheck` and `lint` over it,
 *                and names web or desktop out of it for their test suites.
 *
 * `--only=<name,...>` narrows a set to the named packages (the intersection,
 * in the set's order). It is how the CI lane runs a set over exactly the
 * packages its gate found affected (scripts/turbo-affected.mjs): the set
 * still says what the task means, the list says how much of it applies. A
 * name that is not a workspace member is refused rather than ignored, because
 * a misspelt name that silently selected nothing would make a green job that
 * ran no tests. An empty intersection is not an error: the wrapper says so
 * and exits 0, since "nothing in this set changed" is a normal CI outcome.
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
 *   node scripts/turbo-set.mjs <set> <task> [--only=<name,...>] [turbo flags...]
 *   node scripts/turbo-set.mjs libs build
 *   node scripts/turbo-set.mjs libs build --force        # bypass the cache
 *   node scripts/turbo-set.mjs runner-deps build
 *   node scripts/turbo-set.mjs libs test --only=@stigmer/sdk,@stigmer/react
 *
 * Every extra argument other than --only is handed to `turbo run` unchanged,
 * so `npm run build:libs -- --dry-run` works.
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

/**
 * Package names of every root `workspaces` member, in the root's order. The
 * root manifest is the one list npm itself reads, so a member added there is
 * in this set with no second edit.
 */
export function workspaceSet(rootDir = root) {
  return readManifest(rootDir, "package.json").workspaces.map(
    (relDir) => readManifest(rootDir, join(relDir, "package.json")).name,
  );
}

export const SETS = {
  libs: libsSet,
  "runner-deps": runnerLinkedSet,
  workspace: workspaceSet,
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

const ONLY_FLAG = /^--only(?:=(.*))?$/;

/**
 * Split `--only=<name,...>` out of the caller's flags. Repeated flags merge;
 * `--only` with no names is a usage error, not "everything". Returns
 * `{ only: null, rest }` when the flag is absent.
 */
export function splitOnly(extra) {
  let only = null;
  const rest = [];
  for (const arg of extra) {
    const match = ONLY_FLAG.exec(arg);
    if (!match) {
      rest.push(arg);
      continue;
    }
    const names = (match[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) {
      throw new Error(
        "turbo-set: --only needs at least one package name (--only=<name,...>)",
      );
    }
    only = [...(only ?? []), ...names];
  }
  return { only, rest };
}

/**
 * The packages a run covers: the whole set, or its intersection with `only`
 * in the set's order. Every `only` name must be a workspace member; an
 * unknown name is refused so a typo cannot select nothing and pass.
 */
export function selectPackages(set, only = null, rootDir = root) {
  const members = resolveSet(set, rootDir);
  if (only === null) return members;
  const workspace = new Set(workspaceSet(rootDir));
  const unknown = only.filter((name) => !workspace.has(name));
  if (unknown.length > 0) {
    throw new Error(
      `turbo-set: --only names ${unknown.map((n) => `"${n}"`).join(", ")}, ` +
        "which is not a workspace package.",
    );
  }
  const wanted = new Set(only);
  return members.filter((name) => wanted.has(name));
}

/**
 * The argument list for `turbo run`: the task, one --filter per selected
 * package, the set's own flags, then whatever the caller appended. Returns
 * `null` when `--only` leaves nothing in the set: there is no turbo command
 * that means "run this task over no packages" (no filter at all would mean
 * every package), so the caller must treat null as "nothing to run".
 */
export function turboArgs(set, task, extra = [], rootDir = root) {
  if (!task || task.startsWith("-")) {
    throw new Error(
      "turbo-set: usage: turbo-set.mjs <set> <task> [--only=<name,...>] [turbo flags...]",
    );
  }
  const { only, rest } = splitOnly(extra);
  const packages = selectPackages(set, only, rootDir);
  if (packages.length === 0) return null;
  const args = ["run", task, ...packages.map((name) => `--filter=${name}`)];
  // The set's flags are defaults: a caller who passes the same flag means
  // it (turbo refuses a repeated flag outright).
  if (set === "libs" && task === "test" && !hasFlag(rest, "--concurrency")) {
    args.push("--concurrency=1");
  }
  return [...args, ...rest];
}

function hasFlag(args, flag) {
  return args.some((arg) => arg === flag || arg.startsWith(`${flag}=`));
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
      "turbo-set: usage: turbo-set.mjs <set> <task> [--only=<name,...>] [turbo flags...]",
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
  if (args === null) {
    console.log(
      `turbo-set: no package of the "${set}" set is in --only; nothing to run for "${task}".`,
    );
    return 0;
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
