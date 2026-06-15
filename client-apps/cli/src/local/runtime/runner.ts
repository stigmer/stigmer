// Resolution and on-demand acquisition of the unified runner.
//
// The runner is launched as a compiled `node main.js`, never `tsx src/main.ts`:
// the runner bundles its Temporal workflows on boot and that bundling fails under
// tsx on the raw-.ts proto stubs, which is exactly why the conformance and e2e
// harnesses run `node dist/main.js`. Requiring the build is correctness.
//
// Two acquisition sources, tried in order:
//   1. A repo-tree runner (dev) or an explicit STIGMER_RUNNER_DIR — `dist/main.js`.
//   2. The already-published `@stigmer/runner-slim`, installed on demand into
//      ~/.stigmer/runtimes/<version>/ — `node_modules/@stigmer/runner-slim/main.js`.
//
// (2) deliberately reuses the slim esbuild bundle the desktop already ships
// (stigmer/stigmer#170): one CJS `main.js` plus the few unbundlable native deps,
// with the correct `@stigmer/runner-slim-<platform>` package selected by npm via
// optionalDependencies/os/cpu — ~85 MB instead of the full ~508 MB install. The
// launch contract (`node main.js`) is identical to the repo-tree runner, so the
// daemon spawns either the same way.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { log } from "../../logger.js";
import { VERSION } from "../../version.js";
import { runtimesDir } from "../paths.js";
import { resolveNode } from "./node.js";

const SLIM_PACKAGE = "@stigmer/runner-slim";

/** Everything needed to spawn the runner subprocess. */
export interface RunnerResolution {
  /** Node binary to launch with. */
  nodeBin: string;
  /** Absolute path to the compiled runner entry (`main.js`). */
  entryPath: string;
  /** The runner package directory. */
  appDir: string;
}

export interface EnsureRunnerOptions {
  home?: string;
  /** Release version of the slim runner to acquire (defaults to the CLI version). */
  version?: string;
  /** Node resolver (injectable for tests). */
  node?: () => string;
  /** npm install implementation (injectable for tests). */
  install?: (installDir: string, spec: string) => void;
}

/**
 * Ensure a launchable runner, acquiring `@stigmer/runner-slim` on demand if no
 * repo-tree / STIGMER_RUNNER_DIR runner is present. Throws actionable guidance on
 * a missing build, an invalid override, or a non-release CLI build.
 */
export function ensureRunner(opts: EnsureRunnerOptions = {}): RunnerResolution {
  const node = opts.node ?? resolveNode;
  const local = resolveRunner(node);
  if (local !== null) return local;
  return acquireRunner({ ...opts, node });
}

/**
 * Resolve a repo-tree runner (dev) or an explicit STIGMER_RUNNER_DIR, or null
 * when neither is present (the caller then acquires the slim package). Throws
 * when an override is set but invalid, or when a found runner is not built — both
 * are actionable user-facing conditions, not a reason to silently download.
 * `node` is injectable for tests.
 */
export function resolveRunner(node: () => string = resolveNode): RunnerResolution | null {
  const override = process.env.STIGMER_RUNNER_DIR;
  if (override !== undefined && override !== "") {
    if (!hasPackageJson(override)) {
      throw new CliExitError(`STIGMER_RUNNER_DIR is not a runner package: ${override}`, ExitCode.General, [
        "Point STIGMER_RUNNER_DIR at the @stigmer/runner package directory (the one with package.json).",
      ]);
    }
    return resolveBuiltRunner(override, node);
  }

  const root = repoRoot();
  if (root !== null) {
    const candidate = join(root, "backend", "services", "runner");
    if (hasPackageJson(candidate)) return resolveBuiltRunner(candidate, node);
  }
  return null;
}

/**
 * Acquire the published `@stigmer/runner-slim@<version>` into
 * ~/.stigmer/runtimes/<version>/ (idempotent: reuses a prior install) and resolve
 * its `main.js` entry. The version is pinned to the CLI's own version so the
 * runner's protos/SDK stay in lockstep with the control plane.
 */
export function acquireRunner(opts: EnsureRunnerOptions = {}): RunnerResolution {
  const home = opts.home ?? homedir();
  const version = opts.version ?? VERSION;
  if (!isAcquirableRelease(version)) {
    throw new CliExitError(`cannot acquire ${SLIM_PACKAGE} for a non-release build (${version})`, ExitCode.General, [
      "Run from the repo with a built runner, or set STIGMER_RUNNER_DIR.",
      "On-demand acquisition is only available for published releases.",
    ]);
  }

  const node = opts.node ?? resolveNode;
  const installDir = join(runtimesDir(home), version);
  const entryPath = join(installDir, "node_modules", "@stigmer", "runner-slim", "main.js");

  if (!existsSync(entryPath)) {
    log.info(`acquiring ${SLIM_PACKAGE}`, { version, dir: installDir });
    mkdirSync(installDir, { recursive: true });
    // A stable package.json root makes the install deterministic and records the
    // pinned dependency rather than letting npm synthesize an ad-hoc root.
    writeFileSync(
      join(installDir, "package.json"),
      `${JSON.stringify({ name: "stigmer-runtime", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
    const install = opts.install ?? installRunnerSlim;
    install(installDir, `${SLIM_PACKAGE}@${version}`);
  }

  if (!existsSync(entryPath)) {
    throw new CliExitError(`${SLIM_PACKAGE} install did not produce ${entryPath}`, ExitCode.General, [
      "The install may have skipped the platform-native package for this OS/arch.",
      `Remove ${installDir} and retry, or set STIGMER_RUNNER_DIR to a built runner.`,
    ]);
  }

  return { nodeBin: node(), entryPath, appDir: dirname(entryPath) };
}

// Install the slim package (plus its platform-native optional dependency) into an
// isolated prefix. `--omit=dev` drops devDependencies while keeping the optional
// native package npm selects by os/cpu; output is inherited so the user sees the
// one-time download progress.
function installRunnerSlim(installDir: string, spec: string): void {
  try {
    execFileSync("npm", ["install", spec, "--prefix", installDir, "--omit=dev", "--no-audit", "--no-fund"], {
      stdio: "inherit",
    });
  } catch (err) {
    throw new CliExitError(`failed to install ${spec}`, ExitCode.General, [
      `Command: npm install ${spec} --prefix ${installDir}`,
      "Ensure npm is on PATH and the network is reachable.",
      String(err),
    ]);
  }
}

function resolveBuiltRunner(appDir: string, node: () => string): RunnerResolution {
  const entryPath = join(appDir, "dist", "main.js");
  if (!existsSync(entryPath)) {
    throw new CliExitError(`runner not built: ${entryPath} is missing`, ExitCode.General, [
      "Build it with: npm run build -w @stigmer/protos && npm run build -w @stigmer/runner",
      "The runner must be compiled — it cannot run from source via tsx (Temporal",
      "workflow bundling fails on raw-.ts proto stubs).",
    ]);
  }
  return { nodeBin: node(), entryPath, appDir };
}

// A source build reports "0.0.0-dev" and the dev npm channel stamps "<v>-dev.<stamp>"
// versions; neither publishes a matching @stigmer/runner-slim, so they are not
// acquirable. Release and rc/next versions are.
function isAcquirableRelease(version: string): boolean {
  return !version.includes("-dev");
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}

// Walk up from this module to a repo root containing backend/services/runner.
function repoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (existsSync(join(dir, "backend", "services", "runner", "package.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
