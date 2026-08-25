// Resolution and on-demand acquisition of the stigmer server — the
// TypeScript implementation serving since the DD-006 cutover (D4 #24; the Go
// binary ladder that backed rollback retired with #25).
//
// The server is launched exactly like the runner: a compiled `node main.js`,
// never `tsx src/main.ts` (the workers bundle Temporal workflows on boot in
// dev shape, and the slim artifact ships pre-built bundles — either way the
// entry must be compiled; see the server package's workflow-source.ts).
//
// Resolution order (the D2 §6 switch semantics):
//   1. STIGMER_SERVER_DIR — an explicit server package dir (dist/main.js
//      required), the STIGMER_RUNNER_DIR mirror.
//   2. The repo-tree server package (dev; build required).
//   3. The published `@stigmer/server-slim`, installed on demand into
//      ~/.stigmer/runtimes/<version>/ alongside the runner's package — one
//      CJS main.js, pre-built workflow bundles, and the per-platform
//      Temporal native bridge selected by npm via optionalDependencies.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { log } from "../../logger.js";
import { VERSION } from "../../version.js";
import { runtimesDir } from "../paths.js";
import type { ServerLaunch } from "../daemon/env.js";
import { resolveServerNode } from "./node.js";
import {
  ensureRuntimesRoot,
  isAcquirableRelease,
  npmInstallIntoRuntimes,
  type NpmInstall,
} from "./runtimes-install.js";

const SLIM_PACKAGE = "@stigmer/server-slim";

export interface EnsureServerOptions {
  home?: string;
  /** Release version of the slim server to acquire (defaults to the CLI version). */
  version?: string;
  /** Node resolver (injectable for tests). */
  node?: () => string;
  /** npm install implementation (injectable for tests). */
  install?: NpmInstall;
}

/**
 * Resolve what the daemon launches as `stigmer-server`: the explicit
 * STIGMER_SERVER_DIR override, then the repo tree, then acquiring the
 * published slim package. Throws actionable guidance on a missing build, an
 * invalid override, or a non-release CLI build with nothing local.
 */
export function ensureServer(opts: EnsureServerOptions = {}): ServerLaunch {
  const node = opts.node ?? resolveServerNode;
  const local = resolveServerTs(node);
  if (local !== null) return local;
  return acquireServer({ ...opts, node });
}

/**
 * Resolve a repo-tree TS server (dev) or an explicit STIGMER_SERVER_DIR, or
 * null when neither is present (the caller then acquires the slim package).
 * Throws when an override is set but invalid, or when a found server is not
 * built — both are actionable user-facing conditions, not a reason to
 * silently download. `node` is injectable for tests.
 */
export function resolveServerTs(
  node: () => string = resolveServerNode,
): ServerLaunch | null {
  const override = process.env.STIGMER_SERVER_DIR;
  if (override !== undefined && override !== "") {
    if (!hasPackageJson(override)) {
      throw new CliExitError(
        `STIGMER_SERVER_DIR is not a server package: ${override}`,
        ExitCode.General,
        [
          "Point STIGMER_SERVER_DIR at the @stigmer/server package directory (the one with package.json).",
        ],
      );
    }
    return resolveBuiltServer(override, node);
  }

  const root = repoRoot();
  if (root !== null) {
    const candidate = join(root, "backend", "services", "stigmer-server-ts");
    if (hasPackageJson(candidate)) return resolveBuiltServer(candidate, node);
  }
  return null;
}

/**
 * Acquire the published `@stigmer/server-slim@<version>` into
 * ~/.stigmer/runtimes/<version>/ (idempotent: reuses a prior install; shares
 * the install root with the runner's package) and resolve its `main.js`
 * entry. The version is pinned to the CLI's own version so the server's
 * protos and behavior stay in lockstep with the CLI and the runner.
 */
export function acquireServer(opts: EnsureServerOptions = {}): ServerLaunch {
  const home = opts.home ?? homedir();
  const version = opts.version ?? VERSION;
  if (!isAcquirableRelease(version)) {
    throw new CliExitError(
      `cannot acquire ${SLIM_PACKAGE} for a non-release build (${version})`,
      ExitCode.General,
      [
        "Run from the repo with a built server (make build-server-ts), or set",
        "STIGMER_SERVER_DIR to a built server package.",
        "On-demand acquisition is only available for published releases.",
      ],
    );
  }

  // Probe the Node capability BEFORE the download: a user on an FTS5-less
  // Node must not fetch the full slim artifact only to be rejected after.
  const node = opts.node ?? resolveServerNode;
  const nodeBin = node();
  const installDir = join(runtimesDir(home), version);
  const entryPath = join(
    installDir,
    "node_modules",
    "@stigmer",
    "server-slim",
    "main.js",
  );

  if (!existsSync(entryPath)) {
    log.info(`acquiring ${SLIM_PACKAGE}`, { version, dir: installDir });
    ensureRuntimesRoot(installDir);
    const install = opts.install ?? npmInstallIntoRuntimes;
    install(installDir, `${SLIM_PACKAGE}@${version}`);
  }

  if (!existsSync(entryPath)) {
    throw new CliExitError(
      `${SLIM_PACKAGE} install did not produce ${entryPath}`,
      ExitCode.General,
      [
        "The install may have skipped the platform-native package for this OS/arch.",
        `Remove ${installDir} and retry, or set STIGMER_SERVER_DIR to a built server.`,
      ],
    );
  }

  return {
    nodeBin,
    entryPath,
    appDir: dirname(entryPath),
  };
}

function resolveBuiltServer(appDir: string, node: () => string): ServerLaunch {
  const entryPath = join(appDir, "dist", "main.js");
  if (!existsSync(entryPath)) {
    throw new CliExitError(
      `TS server not built: ${entryPath} is missing`,
      ExitCode.General,
      [
        "Build it with: make build-server-ts",
        "The server must be compiled — it cannot run from source via tsx (its",
        "Temporal workers bundle workflow code from the compiled dist).",
        "STIGMER_SERVER_DIR expects the source package (dist/main.js); to run an",
        "acquired @stigmer/server-slim install, unset it — the CLI resolves that",
        "shape itself.",
      ],
    );
  }
  return { nodeBin: node(), entryPath, appDir };
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}

// Walk up from this module to a repo root containing the TS server package.
function repoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (
      existsSync(
        join(dir, "backend", "services", "stigmer-server-ts", "package.json"),
      )
    )
      return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
